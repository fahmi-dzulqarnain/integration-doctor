import type { Source } from './types.js';

const official = (label: string, url: string): Source => ({ label, url, official: true });
const community = (label: string, url: string): Source => ({ label, url, official: false });

/**
 * Every source a finding or catalogue entry cites, checked on 2026-10-26. The reference pages
 * embed the OpenAPI specifications the field rules come from: MyDHL API 3.4.0, Shipment
 * Tracking – Unified 1.5.8, Location Finder 1.14.0 and Parcel DE Shipping 2.2.0.
 */
export const SOURCES = {
  trackingReference: official(
    'DHL Developer Portal: Shipment Tracking – Unified',
    'https://developer.dhl.com/api-reference/shipment-tracking',
  ),
  tracking401: official(
    'DHL support: 401 Unauthorized from Shipment Tracking – Unified',
    'https://support-developer.dhl.com/support/solutions/articles/47001248620-i-receive-a-401-unauthorized-code-when-calling-the-dhl-shipment-tracking-unified-api',
  ),
  rateLimit: official(
    'DHL support: daily rate limit and spike arrest',
    'https://support-developer.dhl.com/support/solutions/articles/47001242738-what-is-the-daily-rate-limit-and-spike-arrest-how-does-it-work-',
  ),
  rateLimitOverrun: official(
    'DHL support: overrunning the rate limit',
    'https://support-developer.dhl.com/support/solutions/articles/47001224416-what-happens-if-i-accidently-overrun-the-rate-limit-for-shipment-tracking-unified-location-finder-an',
  ),
  sampleNumbers: official(
    'DHL support: no sample tracking numbers per status',
    'https://support-developer.dhl.com/support/solutions/articles/47001197241-are-there-different-sample-tracking-numbers-for-different-statuses-',
  ),
  locationFinderReference: official(
    'DHL Developer Portal: Location Finder – Unified',
    'https://developer.dhl.com/api-reference/location-finder',
  ),
  mydhlReference: official(
    'DHL Developer Portal: MyDHL API (DHL Express)',
    'https://developer.dhl.com/api-reference/dhl-express-mydhl-api',
  ),
  mydhlNonCustomer: official(
    'DHL support: testing MyDHL API without a DHL Express account',
    'https://support-developer.dhl.com/support/solutions/articles/47001224422-i-m-not-a-dhl-express-customer-can-i-test-the-mydhl-express-api-',
  ),
  mydhlUsDomestic: official(
    'DHL support: MyDHL API shipments from the US to the US',
    'https://support-developer.dhl.com/support/solutions/articles/47001224428-i-tried-to-create-shipment-with-mydhl-express-api-from-the-us-to-the-us-but-didn-t-work-',
  ),
  parcelDeReference: official(
    'DHL Developer Portal: Parcel DE Shipping (Post & Parcel Germany) v2',
    'https://developer.dhl.com/api-reference/parcel-de-shipping-post-parcel-germany-v2',
  ),
  shippyProErrors: community(
    'ShippyPro help centre: how to fix MyDHL errors',
    'https://help.shippypro.com/en/articles/5123347-how-to-fix-mydhl-errors',
  ),
  legacyEndpointIssue: community(
    'GitHub issue: old wsbexpress endpoint vs MyDHL API',
    'https://github.com/alex-LE/dhl-express-php-sdk/issues/1',
  ),
  siteIdIssue: community(
    'GitHub issue: "Site Id is wrong" when a sandbox flag is ignored',
    'https://github.com/magento/magento2/issues/40249',
  ),
  dateFormatFix: community(
    'GitHub pull request: MyDHL date format fix',
    'https://github.com/rdersley/dhl-tracking-app/pull/13',
  ),
  wrongProductKey: community(
    'Make community: key not accepted for Shipment Tracking',
    'https://community.make.com/t/dhl-modul-not-accepting-api-key-for-creating-a-connection/110743',
  ),
} as const satisfies Record<string, Source>;
