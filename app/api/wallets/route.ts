import { NextRequest, NextResponse } from "next/server";
import {
  getWallets,
  insertWallet,
  softDeleteWallet,
  updateWalletLabel,
} from "@/lib/db";

const VALID_CHAINS = ["solana", "evm"] as const;

function validateAddress(address: string, chain: string): boolean {
  if (chain === "solana") {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }
  if (chain === "evm") {
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  }
  return false;
}

export async function GET() {
  try {
    const wallets = getWallets();
    return NextResponse.json(wallets);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, chain, label } = body;

    if (!address || !chain) {
      return NextResponse.json(
        { error: "address and chain are required" },
        { status: 400 }
      );
    }

    if (!VALID_CHAINS.includes(chain as "solana" | "evm")) {
      return NextResponse.json(
        { error: `Invalid chain. Valid chains: ${VALID_CHAINS.join(", ")}` },
        { status: 400 }
      );
    }

    if (!validateAddress(address, chain)) {
      return NextResponse.json(
        { error: `Invalid address format for chain ${chain}` },
        { status: 400 }
      );
    }

    const id = insertWallet(address, chain as "solana" | "evm", label);
    return NextResponse.json({ id, address, chain, label });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, label } = body;
    if (!id || label === undefined) {
      return NextResponse.json({ error: "id and label required" }, { status: 400 });
    }
    updateWalletLabel(Number(id), label);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    softDeleteWallet(Number(id));
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
