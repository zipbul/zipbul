import { inject, UseGuards } from '@zipbul/common';
import { RestController, Get, Post, Put, Delete, Body, Param } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

import type { IdRouteParams } from '../interfaces';
import type { ComplexCreateResponse, User } from './interfaces';

import { authGuard } from '../guards/auth.guard';
import { AddressDto } from './dto/address.dto';
import { CreateUserComplexDto } from './dto/complex.dto';
import { SocialDto } from './dto/social.dto';
import { AuditService } from './audit.service';
import { UsersService } from './users.service';

@RestController('users')
export class UsersController {
  private readonly logger = new Logger('UsersController');
  private readonly auditService = inject(AuditService);
  constructor(private readonly usersService: UsersService) {}

  @Get()
  getAll(): ReadonlyArray<User> {
    return this.usersService.findAll();
  }

  @Post('complex')
  complexCreate(@Body() body: CreateUserComplexDto): ComplexCreateResponse<CreateUserComplexDto> {
    this.logger.info('Complex Data Received:', JSON.stringify(body));

    return {
      message: 'Validated and Transformed!',
      data: body,
      isNameString: typeof body.name === 'string',
      isAgeNumber: typeof body.age === 'number',
      isAddressInstance: body.addresses?.[0] instanceof AddressDto,
      isSocialInstance: body.social instanceof SocialDto,
    };
  }

  @Get(':id')
  getById(params: IdRouteParams): User | undefined {
    const id = Number(params.id);

    return this.usersService.findOneById(id);
  }

  @Post()
  create(body: User): void {
    this.usersService.create(body);
  }

  @Put(':id')
  update(params: IdRouteParams, body: User): void {
    const id = Number(params.id);

    this.usersService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(authGuard)
  delete(@Param('id') id: string): void {
    this.auditService.logAction('delete', `userId=${id}`);
    this.usersService.delete(Number(id));
  }
}
