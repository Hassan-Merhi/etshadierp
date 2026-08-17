import type { Express, Response } from "express";

import { requireAuth, requireNonPOS } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { getActiveCustomerCompanyId, parseCustomerId } from "../customers/customerRequestContext";
import { ContainerSaleRouteError, containerSalesService } from "./containerSalesService";

function sendContainerSaleError(res: Response, error: unknown, fallbackStatus: number): Response {
  const statusCode = error instanceof ContainerSaleRouteError ? error.statusCode : fallbackStatus;
  return res.status(statusCode).json({ message: getErrorMessage(error) });
}

export function registerContainerSalesRoutes(app: Express) {
  app.get("/api/container-sales", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = getActiveCustomerCompanyId(req);
      return res.json(await containerSalesService.list(companyId));
    } catch (error: unknown) {
      return sendContainerSaleError(res, error, 500);
    }
  });

  app.get("/api/container-sales/customer/:customerId", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = getActiveCustomerCompanyId(req);
      const customerId = parseCustomerId(req.params.customerId);
      return res.json(await containerSalesService.listByCustomer(customerId, companyId));
    } catch (error: unknown) {
      return sendContainerSaleError(res, error, 500);
    }
  });

  app.post("/api/container-sales", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = getActiveCustomerCompanyId(req);
      const sale = await containerSalesService.create(companyId, req.body, {
        userId: req.session.userId ?? null,
        username: req.session.username || "unknown",
        reason: "Container sale",
      });
      return res.status(201).json(sale);
    } catch (error: unknown) {
      return sendContainerSaleError(res, error, 400);
    }
  });
}
