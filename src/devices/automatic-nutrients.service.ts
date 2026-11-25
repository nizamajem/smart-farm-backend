import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './device.entity';
import { SensorReading } from './sensor-reading.entity';
import { NutrientsService } from './nutrients.service';
import { AutomaticNutrientsDto, plantAge, nutrientRange } from './automatic-nutrients';

@Injectable()
export class AutomaticNutrientsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly locks = new Set<number>();
  private stopping = false;
  constructor(@InjectRepository(Device) private devices: Repository<Device>, @InjectRepository(SensorReading) private readings: Repository<SensorReading>, private nutrients: NutrientsService) {}
  async onModuleInit() {
    // Restart requires an explicit re-enable, after existing dosing jobs recover.
    for (const d of await this.devices.find()) if (d.automaticNutrients?.enabled) {
      await this.pause(d, 'Server dimulai ulang. Periksa alat lalu aktifkan otomatis kembali.');
    }
    this.timer = setInterval(() => { void this.tick().catch(() => {}); }, 10000);
  }
  onModuleDestroy() { this.stopping = true; clearInterval(this.timer); }
  status(d: Device) {
    const hst = plantAge(d.automaticNutrients?.plantedOn);
    const stages = d.automaticNutrients?.stages || [];
    const stage = hst == null ? null : stages.find(s => hst >= s.fromDay && hst <= s.toDay) || null;
    const c=d.automaticNutrients;
    const expired=c && hst!=null && (hst<(c.fromDay??0) || hst>(c.toDay??3650));
    const target=expired?null:stages.length?stage:c;
    return {config:c?{...c,...nutrientRange(c),stages:stages.map(s=>({...s,...nutrientRange(s)}))}:null,state:d.automaticState,hst,targets:target?{...target,...nutrientRange(target)}:null,history:d.nutrientSettingsHistory||[]};
  }
  async save(id:number, config:AutomaticNutrientsDto) {
    if (this.locks.has(id)) throw new ConflictException('Evaluasi otomatis sedang berjalan. Coba lagi sebentar.');
    this.locks.add(id);
    try {
      const d = await this.devices.findOneByOrFail({id});
      if (config.plantedOn) {
        const parsed=new Date(`${config.plantedOn}T00:00:00Z`);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==config.plantedOn || config.plantedOn>new Date(Date.now()+8*3600000).toISOString().slice(0,10)) throw new BadRequestException('Tanggal tanam harus valid dan tidak di masa depan.');
      }
      const range=nutrientRange(config);
      for(const c of [config,...(config.stages||[])]) {
        if ((c.ppmMin==null)!==(c.ppmMax==null) || (c.phMin==null)!==(c.phMax==null)) throw new BadRequestException('Isi kedua batas min dan maks.');
        const r=nutrientRange(c);
        if(!Object.values(r).every(Number.isFinite) || r.ppmMin<1 || r.ppmMax>10000 || r.ppmMin>=r.ppmMax || r.phMin<=0 || r.phMax>=14 || r.phMin>=r.phMax) throw new BadRequestException('Batas minimum harus lebih kecil daripada maksimum.');
      }
      if((config.toDay??3650)<(config.fromDay??0)) throw new BadRequestException('HST akhir harus sama atau lebih besar daripada HST mulai.');
      if((config.fromDay!=null || config.toDay!=null) && !config.plantedOn) throw new BadRequestException('Isi tanggal tanam untuk durasi HST.');
      config={...config,...range,targetPpm:(range.ppmMin+range.ppmMax)/2,targetPh:(range.phMin+range.phMax)/2,ppmTolerance:(range.ppmMax-range.ppmMin)/2,phTolerance:(range.phMax-range.phMin)/2};
      const stages=[...(config.stages || [])].sort((a,b)=>a.fromDay-b.fromDay);
      if (stages.some((s,i)=>s.toDay<s.fromDay || i>0 && s.fromDay<=stages[i-1].toDay)) throw new BadRequestException('Rentang HST tidak boleh terbalik atau tumpang tindih.');
      if (stages.length && !config.plantedOn) throw new BadRequestException('Isi tanggal tanam untuk target berdasarkan HST.');
      if (config.enabled) {
        const hst=plantAge(config.plantedOn);
        if(hst!=null && (hst<(config.fromDay??0) || hst>(config.toDay??3650))) throw new BadRequestException('HST saat ini berada di luar durasi pengaturan.');
        if (!config.ppmEnabled && !config.phEnabled) throw new BadRequestException('Pilih otomatis PPM atau pH.');
        if (d.lastMix?.status==='running' || d.lastPhDose?.status==='running') throw new ConflictException('Tunggu penambahan larutan selesai sebelum mengaktifkan otomatis.');
        if (stages.length && !stages.some(s=>plantAge(config.plantedOn)!>=s.fromDay && plantAge(config.plantedOn)!<=s.toDay)) throw new BadRequestException('HST saat ini belum memiliki target. Tambahkan tahap HST.');
        if (config.ppmEnabled) {
          const plan=this.nutrients.plan(d,config.abDoseLiters);
          if(!plan.ready) throw new BadRequestException(plan.issues.join(' '));
        }
        if (config.phEnabled) for(const channel of ['phUp','phDown'] as const) {
          const plan=this.nutrients.phPlan(d,channel,config.phDoseMl);
          if(!plan.ready || plan.seconds!>60) throw new BadRequestException('Kalibrasi kedua pompa pH dan batasi dosis otomatis menjadi maksimal 60 detik per siklus. '+plan.issues.join(' '));
        }
      }
      // Persist disabled first, so stop cannot be followed by another automatic dose.
      await this.devices.update(id,{automaticNutrients:{...config,enabled:false,stages}});
      if(d.automaticNutrients?.enabled || d.automaticState?.phase) {
        await this.nutrients.stop(id); await this.nutrients.stopPh(id);
      }
      await this.devices.update(id,{automaticNutrients:{...config,stages},automaticState:{cycles:0,message:config.enabled?'Menunggu pembacaan sensor terbaru.':'Otomatis nonaktif.'},nutrientSettingsHistory:[{savedAt:new Date().toISOString(),config:{...config,stages},recipe:d.nutrientRecipe},...(d.nutrientSettingsHistory||[])].slice(0,50)});
      return this.status(await this.devices.findOneByOrFail({id}));
    } finally {this.locks.delete(id);}
  }
  private async pause(d:Device,message:string) {
    await this.devices.update(d.id,{automaticNutrients:{...d.automaticNutrients!,enabled:false},automaticState:{...d.automaticState,cycles:d.automaticState?.cycles||0,message}});
    if(d.lastMix?.status==='running')await this.nutrients.stop(d.id);
    if(d.lastPhDose?.status==='running')await this.nutrients.stopPh(d.id);
  }
  async tick() {
    if(this.stopping)return;
    for(const d of await this.devices.find()) {
      if(!d.automaticNutrients?.enabled || this.locks.has(d.id))continue;
      this.locks.add(d.id);
      try {await this.evaluate(d);} catch {await this.pause(d,'Otomatis dijeda karena pembacaan atau perintah gagal. Periksa alat sebelum mengaktifkan kembali.');}
      finally {this.locks.delete(d.id);}
    }
  }
  private async evaluate(d:Device) {
    const c=d.automaticNutrients!;
    const state=d.automaticState || {cycles:0,message:''};
    const targets=this.status(d).targets;
    if(!targets) {await this.pause(d,'Durasi HST berakhir atau belum ada aturan pada HST ini. Otomatis dijeda.');return;}
    if(d.lastMix?.status==='running' || d.lastPhDose?.status==='running')return;
    let waitUntil=state.waitUntil;
    if(state.phase) {
      const job=state.phase==='ppm'?d.lastMix:d.lastPhDose;
      if(!job || job.status!=='completed') {await this.pause(d,'Dosis dihentikan atau gagal. Otomatis dijeda.');return;}
      waitUntil=new Date(Date.parse(job.finishedAt!)+c.settleSeconds*1000).toISOString();
      await this.devices.update(d.id,{automaticState:{...state,phase:undefined,waitUntil,message:'Menunggu pencampuran dan pembacaan baru.'}});
    }
    if(waitUntil && Date.now()<Date.parse(waitUntil))return;
    const reading=await this.readings.findOne({where:{deviceId:d.id},order:{id:'DESC'}});
    if(!reading || reading.source!=='ha' && (Date.now()-reading.createdAt.getTime()>120000 || reading.createdAt.getTime()>Date.now()+5000)) {
      await this.pause(d,'Sensor belum tersedia atau bacaan lebih dari 2 menit. Otomatis dijeda.');return;
    }
    if(reading.source!=='ha' && (reading.id===state.lastReadingId || waitUntil && reading.createdAt.getTime()<=Date.parse(waitUntil)))return;
    let sensorReport: string | undefined;
    // HA sync can insert cached values. Require the underlying sensor to report again.
    if (reading.source === 'ha') {
      const base = (process.env.HA_BASE_URL || '').replace(/\/+$/, '');
      if (!base || !process.env.HA_TOKEN) throw new Error('HA unavailable');
      const response = await fetch(`${base}/api/states`, {headers:{Authorization:`Bearer ${process.env.HA_TOKEN}`},signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error('HA unavailable');
      const samples = await response.json() as {entity_id:string;state:string;last_reported?:string;last_updated:string}[];
      const reports: string[] = [];
      for (const metric of [ ...(c.ppmEnabled ? ['tds'] as const : []), ...(c.phEnabled ? ['ph'] as const : []) ]) {
        const sample = samples.find(s => s.entity_id === d.haEntities?.[metric]);
        const timestamp = Date.parse(sample?.last_reported || sample?.last_updated || '');
        const value = sample?.state.trim() ? Number(sample.state) : NaN;
        if (!Number.isFinite(timestamp) || Date.now()-timestamp>120000 || timestamp>Date.now()+5000 || !Number.isFinite(value)) {
          await this.pause(d,'Sensor PPM/pH belum melaporkan bacaan terbaru. Otomatis dijeda.');return;
        }
        if(waitUntil && timestamp<=Date.parse(waitUntil))return;
        reading[metric]=value;
        reports.push(`${metric}:${timestamp}:${value}`);
      }
      sensorReport = reports.join('|');
      if (sensorReport === state.lastSensorReport) return;
    }

    if(c.ppmEnabled && (reading.tds==null || !Number.isFinite(reading.tds) || reading.tds<0) || c.phEnabled && (reading.ph==null || !Number.isFinite(reading.ph) || reading.ph<=0 || reading.ph>=14)) {
      await this.pause(d,'Nilai sensor PPM/pH tidak valid. Otomatis dijeda.');return;
    }
    let phase:'ppm'|'ph'|undefined;
    const ppmCorrecting=c.ppmEnabled && (reading.tds!<targets.ppmMin || state.ppmCorrecting===true && reading.tds!<targets.ppmMax);
    if(ppmCorrecting) phase='ppm';
    else if(c.phEnabled && (reading.ph!<targets.phMin || reading.ph!>targets.phMax)) phase='ph';
    if(!phase) {
      await this.devices.update(d.id,{automaticState:{cycles:0,lastReadingId:reading.id,lastSensorReport:sensorReport,message:c.ppmEnabled && reading.tds!>targets.ppmMax?'PPM di atas target. Penambahan nutrisi berhenti; periksa pengenceran air.':'Target stabil. Memantau sensor.'}});return;
    }
    if(state.cycles>=c.maxCycles) {await this.pause(d,'Batas siklus tercapai. Periksa sensor dan larutan sebelum mengaktifkan kembali.');return;}
    if(this.stopping || !(await this.devices.findOneByOrFail({id:d.id})).automaticNutrients?.enabled)return;
    // Reserve durable cycle before dispatch; a restart never repeats the dose.
    await this.devices.update(d.id,{automaticState:{cycles:state.cycles+1,lastReadingId:reading.id,lastSensorReport:sensorReport,ppmCorrecting,phase,message:phase==='ppm'?'Menambahkan nutrisi A + B.':'Menyesuaikan pH.'}});
    if(phase==='ppm') {
      const plan=this.nutrients.plan(d,c.abDoseLiters);
      await this.nutrients.start(d.id,{liters:c.abDoseLiters,newWater:false,mode:'correction',requestId:`auto-ppm-${d.id}-${reading.id}-${Date.now()}`,calibrationKey:plan.calibrationKey},d.ownerId,true);
    } else {
      const channel=reading.ph!<targets.phMin?'phUp':'phDown';
      const plan=this.nutrients.phPlan(d,channel,c.phDoseMl);
      if(plan.seconds!>60)throw new Error('Dose too long');
      await this.nutrients.startPh(d.id,{channel,ml:c.phDoseMl,requestId:`auto-ph-${d.id}-${reading.id}-${Date.now()}`,calibrationKey:plan.calibrationKey},d.ownerId,true);
    }
  }
}
