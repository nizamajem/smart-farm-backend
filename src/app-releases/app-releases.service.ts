import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { open, rename, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { Repository } from 'typeorm';
import { AppRelease } from './app-release.entity';

export interface UploadReleaseBody {
  version?: string;
  notes?: string;
}

const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/;

/** Folder penyimpanan APK: default di samping database agar ikut volume data. */
export const releasesDir = () =>
  process.env.RELEASES_DIR ?? join(dirname(process.env.DB_PATH ?? 'smartfarm.sqlite'), 'releases');

export const MAX_APK_BYTES = Number(process.env.MAX_APK_MB ?? 100) * 1024 * 1024;

@Injectable()
export class AppReleasesService {
  constructor(@InjectRepository(AppRelease) private readonly releases: Repository<AppRelease>) {
    mkdirSync(releasesDir(), { recursive: true });
    // Sisa unggahan yang terputus (mis. koneksi putus / server restart)
    for (const f of readdirSync(releasesDir())) {
      if (f.startsWith('upload-') && f.endsWith('.tmp')) unlinkSync(join(releasesDir(), f));
    }
  }

  list() {
    return this.releases.find({ order: { createdAt: 'DESC', id: 'DESC' } });
  }

  latest() {
    return this.releases.findOne({ where: {}, order: { createdAt: 'DESC', id: 'DESC' } });
  }

  /** Validasi dilakukan di sini (bukan ValidationPipe) agar berkas sementara selalu dibersihkan saat gagal. */
  async create(file: Express.Multer.File | undefined, body: UploadReleaseBody, userId: number) {
    if (!file) throw new BadRequestException('Pilih berkas APK untuk diunggah');
    try {
      const version = (body.version ?? '').trim();
      const notes = (body.notes ?? '').trim();
      if (!VERSION_RE.test(version)) throw new BadRequestException('Versi tidak valid, contoh: 1.0.0');
      if (notes.length > 1000) throw new BadRequestException('Catatan rilis maksimal 1000 karakter');
      if (!file.originalname.toLowerCase().endsWith('.apk')) {
        throw new BadRequestException('Berkas harus berekstensi .apk');
      }
      // APK adalah arsip ZIP: 4 byte pertama "PK\x03\x04"
      const fh = await open(file.path, 'r');
      const { buffer } = await fh.read(Buffer.alloc(4), 0, 4, 0);
      await fh.close();
      if (buffer.toString('binary') !== 'PK\x03\x04') {
        throw new BadRequestException('Berkas bukan APK yang valid');
      }

      const sha256 = await this.hash(file.path);
      const fileName = `smart-farm-${version}-${Date.now()}.apk`;
      await rename(file.path, join(releasesDir(), fileName));

      return this.releases.save(
        this.releases.create({
          version,
          notes,
          fileName,
          size: file.size,
          sha256,
          uploadedById: userId,
        }),
      );
    } catch (e) {
      await unlink(file.path).catch(() => undefined);
      throw e;
    }
  }

  async remove(id: number) {
    const release = await this.releases.findOne({ where: { id } });
    if (!release) throw new NotFoundException('Rilis tidak ditemukan');
    await this.releases.remove(release);
    await unlink(join(releasesDir(), release.fileName)).catch(() => undefined);
    return { ok: true };
  }

  /** Lokasi berkas untuk diunduh + nama unduhan yang rapi; menambah hitungan unduhan. */
  async fileFor(id: number | 'latest') {
    const release = id === 'latest' ? await this.latest() : await this.releases.findOne({ where: { id } });
    if (!release) throw new NotFoundException('Aplikasi belum tersedia');
    const path = join(releasesDir(), release.fileName);
    if (!existsSync(path)) throw new NotFoundException('Berkas aplikasi tidak ditemukan di server');
    await this.releases.increment({ id: release.id }, 'downloads', 1);
    return { path, downloadName: `SmartFarm-${release.version}.apk` };
  }

  private hash(path: string) {
    return new Promise<string>((resolve, reject) => {
      const h = createHash('sha256');
      createReadStream(path)
        .on('data', (chunk) => h.update(chunk))
        .on('end', () => resolve(h.digest('hex')))
        .on('error', reject);
    });
  }
}
