import { codePoints, isRecord } from '../input.js';

/** A small JSON Schema subset: enough to mirror the parts of DHL's schemas this tool checks. */
export interface Field {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  enum?: readonly string[];
  pattern?: RegExp;
  properties?: Record<string, Field>;
  /** False when the schema sets `additionalProperties: false`. */
  additionalProperties?: false;
  items?: Field;
  minItems?: number;
  maxItems?: number;
}

export type Violation =
  | { kind: 'required'; path: string; key: string }
  | { kind: 'type'; path: string; expected: Field['type']; actual: string }
  | { kind: 'minLength' | 'maxLength'; path: string; limit: number; actual: number }
  | { kind: 'minimum'; path: string; limit: number; actual: number }
  | { kind: 'enum'; path: string; allowed: readonly string[]; actual: string }
  | { kind: 'pattern'; path: string; actual: string }
  | { kind: 'minItems' | 'maxItems'; path: string; limit: number; actual: number }
  | { kind: 'extraneous'; path: string; key: string };

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Validates `value` against `field`; paths are dotted, e.g. `content.packages.0.weight`. */
export function validate(value: unknown, field: Field, path = ''): Violation[] {
  const actual = typeOf(value);
  if (actual !== field.type) return [{ kind: 'type', path, expected: field.type, actual }];
  const join = (key: string | number) => (path ? `${path}.${key}` : String(key));

  if (typeof value === 'string') {
    const length = codePoints(value);
    const found: Violation[] = [];
    if (field.minLength !== undefined && length < field.minLength) found.push({ kind: 'minLength', path, limit: field.minLength, actual: length });
    if (field.maxLength !== undefined && length > field.maxLength) found.push({ kind: 'maxLength', path, limit: field.maxLength, actual: length });
    if (field.enum && !field.enum.includes(value)) found.push({ kind: 'enum', path, allowed: field.enum, actual: value });
    if (field.pattern && length > 0 && !field.pattern.test(value)) found.push({ kind: 'pattern', path, actual: value });
    return found;
  }
  if (typeof value === 'number') {
    return field.minimum !== undefined && value < field.minimum ? [{ kind: 'minimum', path, limit: field.minimum, actual: value }] : [];
  }
  if (Array.isArray(value)) {
    const found: Violation[] = [];
    if (field.minItems !== undefined && value.length < field.minItems) found.push({ kind: 'minItems', path, limit: field.minItems, actual: value.length });
    if (field.maxItems !== undefined && value.length > field.maxItems) found.push({ kind: 'maxItems', path, limit: field.maxItems, actual: value.length });
    const items = field.items;
    if (items) value.forEach((item, index) => found.push(...validate(item, items, join(index))));
    return found;
  }
  if (isRecord(value) && field.properties) {
    const found: Violation[] = [];
    for (const [key, child] of Object.entries(field.properties)) {
      if (value[key] === undefined) {
        if (child.required) found.push({ kind: 'required', path, key });
      } else {
        found.push(...validate(value[key], child, join(key)));
      }
    }
    if (field.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in field.properties)) found.push({ kind: 'extraneous', path, key });
      }
    }
    return found;
  }
  return [];
}

// --- MyDHL API 3.4.0, POST /shipments (supermodelIoLogisticsExpressCreateShipmentRequest) ---
// Only the fields this tool checks are listed. Objects marked `additionalProperties: false` in
// the specification list every one of their properties, so no valid key is reported as unknown.

const s = (minLength: number, maxLength: number, extra: Partial<Field> = {}): Field => ({ type: 'string', minLength, maxLength, ...extra });
const req = (field: Field): Field => ({ ...field, required: true });
const loose = (properties: Record<string, Field>, extra: Partial<Field> = {}): Field => ({ type: 'object', properties, ...extra });
const any = (type: Field['type']): Field => ({ type });

const party: Field = loose({
  postalAddress: req(loose({
    // minLength 0: "leave empty if the address doesn't have a postcode".
    postalCode: req(s(0, 12)),
    cityName: req(s(1, 45)),
    countryCode: req(s(2, 2)),
    provinceCode: s(2, 35),
    addressLine1: req(s(1, 45)),
    addressLine2: s(1, 45),
    addressLine3: s(1, 45),
    countyName: s(1, 45),
    provinceName: s(1, 35),
    countryName: s(1, 35),
  })),
  contactInformation: req(loose({
    email: s(1, 70),
    phone: req(s(1, 70)),
    mobilePhone: s(1, 70),
    companyName: req(s(1, 100)),
    fullName: req(s(1, 255)),
  })),
});

export const CREATE_SHIPMENT: Field = loose({
  plannedShippingDateAndTime: req(s(1, 29)),
  pickup: req(loose({
    isRequested: req(any('boolean')),
    closeTime: s(0, 5, { pattern: /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/ }),
    location: s(0, 80),
  })),
  productCode: req(s(1, 6)),
  localProductCode: s(1, 3),
  getRateEstimates: any('boolean'),
  accounts: req({
    type: 'array', minItems: 1, maxItems: 3,
    items: loose({
      typeCode: req(s(1, 15, { enum: ['duties-taxes', 'payer', 'shipper'] })),
      number: req(s(1, 12)),
    }),
  }),
  valueAddedServices: any('array'),
  outputImageProperties: any('object'),
  customerReferences: any('array'),
  identifiers: any('array'),
  customerDetails: req(loose({
    shipperDetails: req(party),
    receiverDetails: req(party),
    buyerDetails: any('object'),
    importerDetails: any('object'),
    exporterDetails: any('object'),
    sellerDetails: any('object'),
    payerDetails: any('object'),
    manufacturerDetails: any('object'),
    ultimateConsigneeDetails: any('object'),
    brokerDetails: any('object'),
  }, { additionalProperties: false })),
  content: req(loose({
    packages: req({
      type: 'array', minItems: 1, maxItems: 999,
      items: loose({
        weight: req({ type: 'number', minimum: 0.001 }),
        dimensions: loose({
          length: req({ type: 'number', minimum: 0.001 }),
          width: req({ type: 'number', minimum: 0.001 }),
          height: req({ type: 'number', minimum: 0.001 }),
        }),
      }),
    }),
    areMorePackagesToBeAddedLater: any('boolean'),
    isCustomsDeclarable: req(any('boolean')),
    declaredValue: { type: 'number', minimum: 0 },
    declaredValueCurrency: s(3, 3),
    exportDeclarations: { type: 'array', minItems: 1, maxItems: 100 },
    description: req(s(1, 70, { pattern: /^[^\s]/ })),
    USFilingTypeValue: s(1, 20),
    incoterm: s(0, 3, { enum: ['CFR', 'CIF', 'CIP', 'CPT', 'DAF', 'DAP', 'DAT', 'DDP', 'DDU', 'DEQ', 'DES', 'DPU', 'EXW', 'FAS', 'FCA', 'FOB'] }),
    unitOfMeasurement: req(s(0, 10, { enum: ['metric', 'imperial'] })),
    dimensionUnitOfMeasurement: s(0, 10, { enum: ['metric', 'imperial'] }),
  }, { additionalProperties: false })),
  documentImages: any('array'),
  onDemandDelivery: any('object'),
  requestOndemandDeliveryURL: any('boolean'),
  shipmentNotification: any('array'),
  prepaidCharges: any('array'),
  getTransliteratedResponse: any('boolean'),
  estimatedDeliveryDate: any('object'),
  getAdditionalInformation: any('array'),
  parentShipment: any('object'),
  encryption: any('object'),
  encryptedDocumentImages: any('array'),
}, { additionalProperties: false });
