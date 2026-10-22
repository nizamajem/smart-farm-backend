import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from './app-setting.entity';

/** Saklar integrasi. Default diambil dari env bila admin belum pernah mengubahnya. */
export const SETTING_DEFAULTS = {
  'mqtt.enabled': () => process.env.MQTT_ENABLED !== 'false',
  'ha.enabled': () => process.env.HA_SYNC_ENABLED !== 'false',
} as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;

@Injectable()
export class SettingsService {
  private readonly cache = new Map<string, unknown>();

  constructor(@InjectRepository(AppSetting) private readonly settings: Repository<AppSetting>) {}

  async getBool(key: SettingKey): Promise<boolean> {
    if (!this.cache.has(key)) {
      const row = await this.settings.findOne({ where: { key } });
      this.cache.set(key, row ? row.value : SETTING_DEFAULTS[key]());
    }
    return this.cache.get(key) === true;
  }

  async setBool(key: SettingKey, value: boolean) {
    await this.settings.save({ key, value });
    this.cache.set(key, value);
    return value;
  }
}
