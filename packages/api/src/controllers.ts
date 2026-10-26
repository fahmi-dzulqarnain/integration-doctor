import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  CATALOGUE,
  diagnose,
  explain,
  type CatalogueEntry,
  type Diagnosis,
  type Explanation,
} from '@integration-doctor/rules';
import { ProbeDto, RequestDto, ResponseDto } from './dto.js';
import { ProbeService, type ProbeResult } from './probe/probe.service.js';

@ApiTags('checks')
// The hourly probe limit applies to the probe only.
@SkipThrottle({ probe: true })
@Controller()
export class ChecksController {
  @Post('diagnose')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Check a DHL API request without sending it',
    description: 'Nothing is sent to DHL and nothing is stored or logged. Prefer a placeholder over a real key: the checks only need its shape.',
  })
  diagnose(@Body() request: RequestDto): Diagnosis {
    return diagnose(request);
  }

  @Post('explain')
  @HttpCode(200)
  @ApiOperation({ summary: 'Explain an error response from a DHL API' })
  explain(@Body() response: ResponseDto): Explanation {
    return explain(response);
  }

  @Get('catalogue')
  @ApiOperation({ summary: 'The known DHL errors, with causes, fixes and sources' })
  catalogue(): (Omit<CatalogueEntry, 'pattern'> & { pattern?: string; patternFlags?: string })[] {
    // A RegExp would serialise as {}, so the pattern is sent as its source text and flags.
    return CATALOGUE.map(({ pattern, ...entry }) => (pattern ? { ...entry, pattern: pattern.source, patternFlags: pattern.flags } : entry));
  }
}

@ApiTags('probe')
@Controller('probe')
export class ProbeController {
  constructor(private readonly probe: ProbeService) {}

  @Post('tracking')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Call DHL Shipment Tracking with the public demo-key',
    description: 'DHL answers the demo-key with one fixed, mocked shipment. Calls are paced to DHL\'s limits for that key '
      + '(per API instance), and each client may make a limited number of calls an hour.',
  })
  @ApiOkResponse({ description: 'DHL\'s answer, whatever its status, with the checks and an explanation' })
  @ApiTooManyRequestsResponse({ description: 'The demo-key pacing or daily quota was hit; see retryAfterSeconds' })
  track(@Body() input: ProbeDto): Promise<ProbeResult> {
    return this.probe.trackShipment(input);
  }
}

@ApiTags('health')
@SkipThrottle({ default: true, probe: true })
@Controller('health')
export class HealthController {
  /** Liveness and readiness: the API holds no connections that could go stale. */
  @Get()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
