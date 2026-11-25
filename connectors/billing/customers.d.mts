export type Customers = { INTERNAL: Record<string, string>; EXTERNAL: Record<string, string> };
export declare function customersFrom(text: string | undefined): Customers;
