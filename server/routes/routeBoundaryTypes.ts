import type { RequestHandler } from "express";
import type { db } from "../db";

/** Shared dependency contracts for split route-registration modules. */
export type AuthMiddleware = RequestHandler;
export type AppDb = typeof db;
