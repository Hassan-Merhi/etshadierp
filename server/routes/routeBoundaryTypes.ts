import type { RequestHandler } from "express";
import type { Database } from "../db";

/** Shared dependency contracts for split route-registration modules. */
export type AuthMiddleware = RequestHandler;
/** The Drizzle handle injected into route registrars; alias of the canonical `Database`. */
export type AppDb = Database;
