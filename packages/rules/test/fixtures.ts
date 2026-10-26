import type { RequestInput } from '../src/index.js';

/** Fixed "now" for date rules: Monday 26 October 2026, 09:00 in Kuala Lumpur. */
export const NOW = new Date('2026-10-26T01:00:00Z');

export const TRACKING_URL = 'https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186';

export const trackingRequest = (overrides: Partial<RequestInput> = {}): RequestInput => ({
  method: 'GET',
  url: TRACKING_URL,
  headers: { 'DHL-API-Key': 'k3yForTestsOnly' },
  ...overrides,
});

/** A MyDHL shipment request that satisfies every rule (made-up parties, example.com). */
export function validShipment(): Record<string, unknown> {
  return {
    plannedShippingDateAndTime: '2026-10-27T10:00:00GMT+08:00',
    pickup: { isRequested: false, closeTime: '18:00' },
    productCode: 'P',
    accounts: [{ typeCode: 'shipper', number: '123456789' }],
    customerDetails: {
      shipperDetails: {
        postalAddress: { postalCode: '63000', cityName: 'Cyberjaya', countryCode: 'MY', addressLine1: '1 Persiaran Example' },
        contactInformation: { phone: '+60 3 0000 0000', companyName: 'Example Sdn Bhd', fullName: 'Ana Example', email: 'ana@example.com' },
      },
      receiverDetails: {
        postalAddress: { postalCode: '018989', cityName: 'Singapore', countryCode: 'SG', addressLine1: '2 Example Street' },
        contactInformation: { phone: '+65 0000 0000', companyName: 'Example Pte Ltd', fullName: 'Ben Example' },
      },
    },
    content: {
      packages: [{ weight: 1.5, dimensions: { length: 20, width: 15, height: 10 } }],
      isCustomsDeclarable: false,
      description: 'Documents',
      unitOfMeasurement: 'metric',
    },
  };
}

export const shipmentRequest = (body: unknown = validShipment(), overrides: Partial<RequestInput> = {}): RequestInput => ({
  method: 'POST',
  url: 'https://express.api.dhl.com/mydhlapi/test/shipments?validateDataOnly=true',
  headers: { Authorization: `Basic ${btoa('apiUser:apiPassword')}`, 'Content-Type': 'application/json', 'x-version': '3.4.0' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  ...overrides,
});

/**
 * Error bodies in the formats DHL uses. The Tracking and MyDHL 401 bodies were captured on
 * 2026-10-26; the Tracking 429 and 404 texts are illustrative; the MyDHL messages are quoted from
 * specification 3.4.0's examples or, for 996, 7121 and 8007, from an integrator.
 */
export const DHL_BODIES = {
  trackingNoKey: '{"status":401,"title":"Unauthorized","detail":"Access to the resource is not allowed."}',
  trackingWrongProduct: '{"status":401,"title":"Unauthorized","detail":"Unauthorized for given resource."}',
  trackingQuota: '{"status":429,"title":"Too Many Requests","detail":"Rate limit quota violation. Quota limit exceeded."}',
  trackingNotFound: '{"status":404,"title":"No result found","detail":"No shipment with given tracking number found."}',
  mydhlBadCredentials: '{"reasons":[{"msg":"Invalid Credentials"}],"details":{"msgId":"Id-1a2b3c"}}',
  mydhlDate: '{"instance":"/expressapi/shipments","detail":"998: ShipTimeStamp is not well formatted.(Expected Sample Format : \'2010-02-11T17:10:09 GMT+01:00\')","title":"Bad request","message":"Bad request","status":"400"}',
  mydhlRequired: '{"instance":"/expressapi/shipments","detail":"Multiple problems found, see Additional Details","title":"Bad request","message":"Bad request","status":"400","additionalDetails":["#/customerDetails/shipperDetails/postalAddress: required key [countryCode] not found"]}',
  mydhlMaxLength: '{"instance":"/expressapi/shipments","detail":"Multiple problems found, see Additional Details","title":"Bad request","status":"400","additionalDetails":["#/customerDetails/shipperDetails/postalAddress/cityName: expected maxLength: 45, actual: 49"]}',
  mydhlQueryFormat: '{"instance":"/expressapi/address-validate","detail":"Parameters not having correct format: cityName (maxLength=45)","title":"Wrong format","status":"400"}',
  mydhlTwoCodes: '{"instance":"/expressapi/shipments","detail":"Multiple problems found, see Additional Details","title":"Bad request","status":"400","additionalDetails":["7008: The requested Special Service Code is not available","998: ShipTimeStamp is not well formatted."]}',
  parcelDe401: '{"title":"Unauthorized","status":401,"detail":"Authentication is required or the supplied credentials are invalid."}',
  mydhl7121: '{"instance":"/expressapi/shipments","detail":"7121: #/content/exportDeclaration is mandatory when provided product is dutiable, please update and try again.","title":"Bad request","status":"422"}',
  mydhl996: '{"detail":"996: The requested product(s) not available for the requested pickup date. Process ID associated for this transaction","title":"Unprocessable","status":"422"}',
  mydhl8007: '{"detail":"8007: The Shipper Account is invalid.","title":"Bad request","status":"400"}',
  legacySiteId: 'Validation Failure:Site Id is wrong',
} as const;
