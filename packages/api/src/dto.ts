import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  Validate,
} from 'class-validator';
import { TRACKING_SERVICES } from '@integration-doctor/rules';

/** Generous for a shipment payload with many packages, small enough to bound the work per call. */
const MAX_BODY = 512 * 1024;

@ValidatorConstraint({ name: 'stringHeaders' })
class StringHeaders implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= 100 && entries.every(([name, v]) => name.length <= 256 && typeof v === 'string' && v.length <= 8192);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must map header names to string values (at most 100 headers)`;
  }
}

export class RequestDto {
  @ApiProperty({ example: 'GET' })
  @IsString()
  @MaxLength(16)
  method: string;

  @ApiProperty({ example: 'https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186' })
  @IsString()
  @MaxLength(8192)
  url: string;

  @ApiPropertyOptional({ example: { 'DHL-API-Key': 'demo-key' }, description: 'Header names to values.' })
  @IsOptional()
  @Validate(StringHeaders)
  headers?: Record<string, string>;

  @ApiPropertyOptional({ description: 'The raw request body, as sent.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BODY)
  body?: string;
}

export class ResponseDto {
  @ApiProperty({ example: 401 })
  @IsInt()
  @Min(100)
  @Max(599)
  status: number;

  @ApiPropertyOptional({ example: '{"status":401,"title":"Unauthorized","detail":"Unauthorized for given resource."}' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BODY)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Validate(StringHeaders)
  headers?: Record<string, string>;

  @ApiPropertyOptional({ type: RequestDto, description: 'The request that produced the response, when known.' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RequestDto)
  request?: RequestDto;
}

export class ProbeDto {
  @ApiProperty({ example: '00340434292135100186' })
  @IsString()
  @Matches(/^[A-Za-z0-9-]{4,64}$/, { message: 'trackingNumber must be 4 to 64 letters, digits or hyphens' })
  trackingNumber: string;

  @ApiPropertyOptional({ enum: TRACKING_SERVICES })
  @IsOptional()
  @IsIn(TRACKING_SERVICES)
  service?: string;
}
