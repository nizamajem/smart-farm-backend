import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { ActivityLog } from './activity-log.entity';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

/** Global: modul lain cukup menyuntikkan ActivityService untuk mencatat aksi. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ActivityLog, User])],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
