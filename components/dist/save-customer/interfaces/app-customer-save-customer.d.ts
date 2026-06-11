/** @module Interface app:customer/save-customer@0.1.0 **/
export function invoke(input: SaveCustomerInput): void;
export interface SaveCustomerInput {
  name: string,
  email: string,
}
