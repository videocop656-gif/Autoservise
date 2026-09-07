import { describe, it, expect } from 'vitest'
import { createVehicleSchema, updateVehicleSchema, vehicleIdParamSchema } from '../src/server/validation/vehicle.schemas'

const VALID_CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174000'

describe('createVehicleSchema', () => {
  it('accepts a minimal valid payload', () => {
    const result = createVehicleSchema.parse({ customerId: VALID_CUSTOMER_ID, make: 'Toyota', model: 'Camry' })
    expect(result.make).toBe('Toyota')
  })

  it('normalizes licensePlate and vin to uppercase', () => {
    const result = createVehicleSchema.parse({
      customerId: VALID_CUSTOMER_ID,
      make: 'Toyota',
      model: 'Camry',
      licensePlate: 'a123bc',
      vin: 'abc123def456',
    })
    expect(result.licensePlate).toBe('A123BC')
    expect(result.vin).toBe('ABC123DEF456')
  })

  it('rejects an invalid customerId', () => {
    expect(() => createVehicleSchema.parse({ customerId: 'not-a-uuid', make: 'Toyota', model: 'Camry' })).toThrow()
  })

  it('rejects a missing make', () => {
    expect(() => createVehicleSchema.parse({ customerId: VALID_CUSTOMER_ID, model: 'Camry' })).toThrow()
  })

  it('rejects a missing model', () => {
    expect(() => createVehicleSchema.parse({ customerId: VALID_CUSTOMER_ID, make: 'Toyota' })).toThrow()
  })

  it('accepts a valid year range', () => {
    expect(() =>
      createVehicleSchema.parse({ customerId: VALID_CUSTOMER_ID, make: 'Toyota', model: 'Camry', year: 2020 })
    ).not.toThrow()
  })

  it('rejects a year before 1886', () => {
    expect(() =>
      createVehicleSchema.parse({ customerId: VALID_CUSTOMER_ID, make: 'Toyota', model: 'Camry', year: 1885 })
    ).toThrow()
  })

  it('rejects a year after 2100', () => {
    expect(() =>
      createVehicleSchema.parse({ customerId: VALID_CUSTOMER_ID, make: 'Toyota', model: 'Camry', year: 2101 })
    ).toThrow()
  })

  it('rejects negative mileage', () => {
    expect(() =>
      createVehicleSchema.parse({ customerId: VALID_CUSTOMER_ID, make: 'Toyota', model: 'Camry', mileage: -1 })
    ).toThrow()
  })

  it('rejects mileage over the technical limit', () => {
    expect(() =>
      createVehicleSchema.parse({ customerId: VALID_CUSTOMER_ID, make: 'Toyota', model: 'Camry', mileage: 2_000_001 })
    ).toThrow()
  })

  it('accepts mileage at the boundary (0 and 2,000,000)', () => {
    expect(() =>
      createVehicleSchema.parse({ customerId: VALID_CUSTOMER_ID, make: 'Toyota', model: 'Camry', mileage: 0 })
    ).not.toThrow()
    expect(() =>
      createVehicleSchema.parse({ customerId: VALID_CUSTOMER_ID, make: 'Toyota', model: 'Camry', mileage: 2_000_000 })
    ).not.toThrow()
  })
})

describe('updateVehicleSchema', () => {
  it('accepts a partial update', () => {
    expect(() => updateVehicleSchema.parse({ mileage: 50000 })).not.toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => updateVehicleSchema.parse({})).toThrow()
  })

  it('does not accept customerId (ownership transfer is not supported)', () => {
    const result = updateVehicleSchema.parse({ make: 'Honda' }) as Record<string, unknown>
    expect(result.customerId).toBeUndefined()
  })

  it('a field omitted from the update payload is absent from the parsed result (leave-unchanged)', () => {
    const result = updateVehicleSchema.parse({ mileage: 100 }) as Record<string, unknown>
    expect('make' in result).toBe(false)
    expect('licensePlate' in result).toBe(false)
    expect('year' in result).toBe(false)
  })

  it('null explicitly clears an optional field', () => {
    const result = updateVehicleSchema.parse({ year: null })
    expect(result.year).toBeNull()
  })

  it('an empty/whitespace string clears an optional string field to null', () => {
    const result = updateVehicleSchema.parse({ licensePlate: '   ' })
    expect(result.licensePlate).toBeNull()
  })

  it('rejects clearing the required make/model via null or an empty string', () => {
    expect(() => updateVehicleSchema.parse({ make: null })).toThrow()
    expect(() => updateVehicleSchema.parse({ make: '' })).toThrow()
    expect(() => updateVehicleSchema.parse({ model: null })).toThrow()
  })
})

describe('vehicleIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    expect(() => vehicleIdParamSchema.parse(VALID_CUSTOMER_ID)).not.toThrow()
  })

  it('rejects a non-UUID string', () => {
    expect(() => vehicleIdParamSchema.parse('not-a-uuid')).toThrow()
  })
})
