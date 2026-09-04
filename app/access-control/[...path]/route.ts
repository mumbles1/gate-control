import { proxyAccessControl } from "../../access-control-proxy";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path?: string[] }> };
async function run(request: Request, context: Context) { return proxyAccessControl(request, (await context.params).path ?? []); }

export async function GET(request: Request, context: Context) { return run(request, context); }
export async function POST(request: Request, context: Context) { return run(request, context); }
export async function PUT(request: Request, context: Context) { return run(request, context); }
export async function DELETE(request: Request, context: Context) { return run(request, context); }
export async function HEAD(request: Request, context: Context) { return run(request, context); }
