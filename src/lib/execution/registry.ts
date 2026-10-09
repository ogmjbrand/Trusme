import type { ToolContextBase, ToolDefinition } from "./types";

/** Explicit allow-list of tools the planner and engine may use. */
export class ToolRegistry<C extends ToolContextBase = ToolContextBase> {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown, C>>();

  register<I, O>(def: ToolDefinition<I, O, C>): this {
    if (this.tools.has(def.id)) throw new Error(`Duplicate tool id ${def.id}`);
    if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(def.id)) throw new Error(`Invalid tool id ${def.id}`);
    this.tools.set(def.id, def as unknown as ToolDefinition<unknown, unknown, C>);
    return this;
  }

  get(id: string): ToolDefinition<unknown, unknown, C> | undefined {
    return this.tools.get(id);
  }

  list(): ToolDefinition<unknown, unknown, C>[] {
    return [...this.tools.values()];
  }

  ids(): string[] {
    return [...this.tools.keys()];
  }
}
