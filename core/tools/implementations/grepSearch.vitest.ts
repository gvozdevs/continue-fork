import { describe, expect, it } from "vitest";
import { grepQueriesFromArgs } from "./grepSearch";

describe("grepQueriesFromArgs", () => {
  it("keeps a single query", () => {
    expect(grepQueriesFromArgs({ query: "FR2" })).toEqual(["FR2"]);
  });

  it("keeps every query from one call", () => {
    expect(
      grepQueriesFromArgs({ queries: ["swagger", "FR2", "endpoint"] }),
    ).toEqual(["swagger", "FR2", "endpoint"]);
  });

  it("prefers queries[] when both are present", () => {
    expect(
      grepQueriesFromArgs({ query: "ignored", queries: ["keep"] }),
    ).toEqual(["keep"]);
  });
});
