import { Module } from '@nestjs/common';

import { CitiesController } from './cities.controller.js';

@Module({ controllers: [CitiesController] })
export class CitiesModule {}
