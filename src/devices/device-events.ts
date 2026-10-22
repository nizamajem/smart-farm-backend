import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import { RelayCommand } from './relay-command.entity';

/** Event antar-modul tanpa ketergantungan melingkar (mis. MQTT mengirim perintah relay seketika). */
@Injectable()
export class DeviceEvents extends EventEmitter {
  commandCreated(command: RelayCommand) {
    this.emit('command.created', command);
  }

  onCommandCreated(listener: (command: RelayCommand) => void) {
    this.on('command.created', listener);
  }
}
