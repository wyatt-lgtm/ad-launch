export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const policies = await prisma.contentPolicy.findMany({
      orderBy: [{ action: 'asc' }, { category: 'asc' }],
    });
    return NextResponse.json(policies);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { category, action, keywords, description, label } = body;
    if (!category || !action) {
      return NextResponse.json({ error: 'category and action required' }, { status: 400 });
    }

    const policy = await prisma.contentPolicy.create({
      data: {
        category,
        action,
        keywords: keywords || [],
        description: description || '',
        label: label || category,
        isActive: true,
      },
    });

    return NextResponse.json(policy);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, enabled, ...rest } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // Map 'enabled' to 'isActive' for the frontend
    const data: any = { ...rest };
    if (enabled !== undefined) data.isActive = enabled;

    const policy = await prisma.contentPolicy.update({
      where: { id },
      data,
    });

    return NextResponse.json(policy);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
