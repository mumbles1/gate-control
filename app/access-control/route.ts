import { proxyAccessControl } from "../access-control-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) { return proxyAccessControl(request); }
export async function POST(request: Request) { return proxyAccessControl(request); }
export async function PUT(request: Request) { return proxyAccessControl(request); }
export async function DELETE(request: Request) { return proxyAccessControl(request); }
export async function HEAD(request: Request) { return proxyAccessControl(request); }
