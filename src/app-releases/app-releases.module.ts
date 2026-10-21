import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppRelease } from './app-release.entity';
import { AppReleasesController } from './app-releases.controller';
import { AppReleasesService } from './app-releases.service';

@Module({
  imports: [TypeOrmModule.forFeature([AppRelease])],
  controllers: [AppReleasesController],
  providers: [AppReleasesService],
})
export class AppReleasesModule {}
