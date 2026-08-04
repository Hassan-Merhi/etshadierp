#!/usr/bin/env python3
from pathlib import Path

index_path = Path("server/index.ts")
index_source = index_path.read_text()
old = '''    canSellNegativeStock?: boolean;
    daybookEditDays?: number;'''
new = '''    canSellNegativeStock?: boolean;
    posViewOnly?: boolean;
    daybookEditDays?: number;'''
if new not in index_source:
    if old not in index_source:
        raise RuntimeError("Could not find SessionData permission declaration")
    index_source = index_source.replace(old, new, 1)
index_path.write_text(index_source)

route_path = Path("server/routes/auth/coreAuthRoutes.ts")
route_source = route_path.read_text()
route_source = route_source.replace(
    '(req.session as any).posViewOnly = firstCompany.posViewOnly ?? false;',
    'req.session.posViewOnly = firstCompany.posViewOnly ?? false;',
)
route_source = route_source.replace(
    'posViewOnly: Boolean((req.session as any).posViewOnly ?? false),',
    'posViewOnly: Boolean(req.session.posViewOnly ?? false),',
)
route_path.write_text(route_source)
