import { SOURCES } from '../sources.js';
import type { Finding } from '../types.js';
import type { Rule } from './context.js';

/** `service` values in the Shipment Tracking – Unified specification 1.5.8. */
export const TRACKING_SERVICES = [
  'dgf', 'dsc', 'ecommerce', 'ecommerce-apac', 'ecommerce-europe', 'ecommerce-ppl', 'ecommerce-iberia',
  'express', 'freight', 'parcel-de', 'parcel-nl', 'parcel-pl', 'parcel-uk', 'post-de',
  'post-international', 'sameday', 'svb',
] as const;

/** Wrong methods and paths are reported by the endpoint rule; these check the query. */
export const trackingRules: Rule[] = [
  ({ detection, url }) => {
    if (detection.api !== 'tracking' || detection.operation !== 'GET /shipments' || !url) return [];
    const numbers = url.searchParams.getAll('trackingNumber');
    const number = numbers[0];
    if (number === undefined || number.trim() === '') {
      const nearMiss = [...url.searchParams.keys()].find((name) => /^tracking[-_]?(number|no|id)$/i.test(name));
      return [{
        ruleId: 'tracking.missing-number',
        severity: 'error',
        title: 'No trackingNumber parameter',
        detail: nearMiss
          ? `The URL has "${nearMiss}", but the parameter is spelled trackingNumber.`
          : 'trackingNumber is the one required query parameter.',
        fix: 'Add ?trackingNumber=<number> to the URL.',
        sources: [SOURCES.trackingReference],
      }];
    }
    const findings: Finding[] = [];
    if (numbers.length > 1) {
      findings.push({
        ruleId: 'tracking.repeated-number',
        severity: 'warning',
        title: 'trackingNumber appears more than once',
        detail: `The URL sends ${numbers.length} trackingNumber values, but the specification defines it as a single string, so the request asks for one shipment.`,
        fix: 'Send one trackingNumber per request, and space requests at least 5 seconds apart to stay inside the rate limit.',
        sources: [SOURCES.trackingReference, SOURCES.rateLimit],
      });
    }
    if (number !== number.trim() || /\s/.test(number.trim())) {
      findings.push({
        ruleId: 'tracking.number-whitespace',
        severity: 'warning',
        title: 'The tracking number contains spaces',
        detail: 'Numbers copied from labels and emails often carry spaces. Tracking numbers have none, so a spaced number can come back as 404 "Shipment was not found".',
        fix: 'Remove all spaces from the number before sending it.',
        sources: [SOURCES.trackingReference],
      });
    }
    return findings;
  },

  ({ detection, url }) => {
    if (detection.api !== 'tracking' || !url) return [];
    const service = url.searchParams.get('service');
    if (service === null || (TRACKING_SERVICES as readonly string[]).includes(service)) return [];
    return [{
      ruleId: 'tracking.unknown-service',
      severity: 'error',
      title: `"${service}" is not a Shipment Tracking service`,
      detail: `Allowed values are: ${TRACKING_SERVICES.join(', ')}.`,
      fix: 'Use one of the listed values, in lowercase, or leave service out to let DHL search all services.',
      sources: [SOURCES.trackingReference],
    }];
  },
];
