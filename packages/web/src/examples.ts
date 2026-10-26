import type { DraftRequest } from './curl.js';

/** Requests with the mistakes integrators report most. Credentials are placeholders. */
export const REQUEST_EXAMPLES: { label: string; request: DraftRequest }[] = [
  {
    label: 'Tracking with a Bearer token',
    request: {
      method: 'GET',
      url: 'https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186',
      headers: [['Authorization', 'Bearer your-api-key']],
      body: '',
    },
  },
  {
    label: 'Tracking number with spaces',
    request: {
      method: 'GET',
      url: 'https://api-eu.dhl.com/track/shipments?trackingNumber=0034 0434 2921 3510 0186&service=dhl',
      headers: [['DHL-API-Key', 'demo-key']],
      body: '',
    },
  },
  {
    label: 'MyDHL shipment with an ISO date',
    request: {
      method: 'POST',
      url: 'https://express.api.dhl.com/mydhlapi/test/shipments',
      headers: [['Authorization', `Basic ${btoa('apiUser:apiPassword')}`], ['Content-Type', 'application/json']],
      body: JSON.stringify({
        plannedShippingDateAndTime: '2026-11-02T10:00:00+08:00',
        pickup: { isRequested: false },
        productCode: 'P',
        accounts: [{ typeCode: 'shipper', number: '123456789' }],
        customerDetails: {
          shipperDetails: {
            postalAddress: { postalCode: '63000', cityName: 'Cyberjaya', countryCode: 'my', addressLine1: 'Level 3, Block A, 1 Persiaran Example, Cyber 8 Business District' },
            contactInformation: { phone: '+60 3 0000 0000', companyName: 'Example Sdn Bhd', fullName: 'Ana Example' },
          },
          receiverDetails: {
            postalAddress: { postalCode: '018989', cityName: 'Singapore', countryCode: 'SG', addressLine1: '2 Example Street' },
            contactInformation: { phone: '+65 0000 0000', companyName: 'Example Pte Ltd', fullName: 'Ben Example' },
          },
        },
        content: {
          packages: [{ weight: 1.5, dimensions: { length: 20, width: 15, height: 10 } }],
          isCustomsDeclarable: true,
          declaredValue: 120,
          declaredValueCurrency: 'MYR',
          description: 'Spare parts',
          unitOfMeasurement: 'metric',
        },
      }, null, 2),
    },
  },
  {
    label: 'Retired XML-PI endpoint',
    request: {
      method: 'POST',
      url: 'https://xmlpi-ea.dhl.com/XMLShippingServlet',
      headers: [['Content-Type', 'application/xml']],
      body: '<req:ShipmentRequest>…</req:ShipmentRequest>',
    },
  },
  {
    label: 'Parcel DE with Basic auth only',
    request: {
      method: 'POST',
      url: 'https://api-sandbox.dhl.com/parcel/de/shipping/v2/orders',
      headers: [['Authorization', `Basic ${btoa('sandboxUser:sandboxPassword')}`], ['Content-Type', 'application/json']],
      body: '{"profile":"STANDARD_GRUPPENPROFIL","shipments":[]}',
    },
  },
];

/** Error bodies in the formats DHL uses (see the rules package's fixtures for their provenance). */
export const RESPONSE_EXAMPLES: { label: string; status: number; body: string; url: string }[] = [
  {
    label: 'Tracking: 401 for given resource',
    status: 401,
    url: 'https://api-eu.dhl.com/track/shipments?trackingNumber=00340434292135100186',
    body: '{"status":401,"title":"Unauthorized","detail":"Unauthorized for given resource."}',
  },
  {
    label: 'MyDHL: 998 date format',
    status: 400,
    url: 'https://express.api.dhl.com/mydhlapi/test/shipments',
    body: '{"instance":"/expressapi/shipments","detail":"998: ShipTimeStamp is not well formatted.(Expected Sample Format : \'2010-02-11T17:10:09 GMT+01:00\')","title":"Bad request","message":"Bad request","status":"400"}',
  },
  {
    label: 'MyDHL: address line too long',
    status: 400,
    url: 'https://express.api.dhl.com/mydhlapi/test/shipments',
    body: '{"instance":"/expressapi/shipments","detail":"Multiple problems found, see Additional Details","title":"Bad request","status":"400","additionalDetails":["#/customerDetails/shipperDetails/postalAddress/addressLine1: expected maxLength: 45, actual: 63"]}',
  },
  {
    label: 'MyDHL: 996 pickup date',
    status: 422,
    url: 'https://express.api.dhl.com/mydhlapi/test/shipments',
    body: '{"detail":"996: The requested product(s) not available for the requested pickup date. Process ID associated for this transaction","title":"Unprocessable","status":"422"}',
  },
];
