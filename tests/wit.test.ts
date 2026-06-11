import { describe, expect, it } from "vitest";
import type { Contract, DataStore } from "../src/kernel/types";
import { contractToWit, kebab } from "../src/runtime/wit";

const stores: DataStore[] = [
  {
    id: "s1",
    name: "customers",
    schema: [
      { name: "name", type: "string" },
      { name: "email", type: "string" },
    ],
  },
];

describe("kebab", () => {
  it("normalizes names", () => {
    expect(kebab("save-customer")).toBe("save-customer");
    expect(kebab("saveCustomer")).toBe("save-customer");
    expect(kebab("Save Customer!")).toBe("save-customer");
    expect(kebab("")).toBe("contract");
  });
});

describe("contractToWit", () => {
  it("projects signature, grants, and predicates-free shape", () => {
    const contract: Contract = {
      id: "c1",
      name: "save-customer",
      signature: {
        inputs: [
          { name: "name", type: "string" },
          { name: "email", type: "string" },
        ],
        result: { t: "error" },
      },
      grants: [{ t: "kv", store: "s1", mode: "rw" }, { t: "toast" }],
      predicates: [],
      body: { t: "unfilled" },
    };
    expect(contractToWit(contract, stores)).toBe(
      `package app:project;

interface save-customer {
  record save-customer-input { name: string, email: string }
  invoke: func(input: save-customer-input) -> result<_, string>;
}

world save-customer-body {
  import app:caps/kv-store;
  import app:caps/toast;
  export save-customer;
}
`,
    );
  });

  it("declares row records for record(store) inputs and notes empty grants", () => {
    const contract: Contract = {
      id: "c2",
      name: "select-customer",
      signature: {
        inputs: [{ name: "row", type: { record: "s1" } }],
        result: { t: "ok" },
      },
      grants: [],
      predicates: [],
      body: { t: "unfilled" },
    };
    const wit = contractToWit(contract, stores);
    expect(wit).toContain("record customers-row { name: string, email: string }");
    expect(wit).toContain("invoke: func(input: select-customer-input);");
    expect(wit).toContain("// no grants — no imports: effects are physically absent");
  });
});
