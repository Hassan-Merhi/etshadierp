import { Router, type Express, type RequestHandler } from "express";

type RouteRegistrar = (app: Express) => void | Promise<void>;

interface LazyRouteModuleOptions {
  prefixes: readonly string[];
  load: () => Promise<RouteRegistrar>;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Keep optional route dependency graphs out of production baseline RSS.
 *
 * Development and tests stay eager so route-manifest and integration coverage
 * see the exact same Express stack as before. In production, a lightweight
 * middleware occupies the original registration position and loads the route
 * module into a private Router on the first matching request.
 */
export async function registerLazyRouteModule(app: Express, options: LazyRouteModuleOptions): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    const registrar = await options.load();
    await registrar(app);
    return;
  }

  const router = Router();
  let loadPromise: Promise<void> | null = null;

  const ensureLoaded = (): Promise<void> => {
    if (!loadPromise) {
      loadPromise = options
        .load()
        .then(async (registrar) => {
          await registrar(router as unknown as Express);
        })
        .catch((error) => {
          loadPromise = null;
          throw error;
        });
    }
    return loadPromise;
  };

  const middleware: RequestHandler = (req, res, next) => {
    if (!options.prefixes.some((prefix) => matchesPrefix(req.path, prefix))) {
      next();
      return;
    }

    void ensureLoaded().then(
      () => router(req, res, next),
      (error) => next(error)
    );
  };

  app.use(middleware);
}
