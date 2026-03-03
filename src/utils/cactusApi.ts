const CACTUS_BASE_URL = 'https://cactus-public-api-dev.lookingglassprotocol.com';
export const DEFAULT_DOMAIN_ID = '8093f9bf-c374-4162-ab74-ab61949627f1';

export interface CactusProduct {
  productName: string;
  productId: string;
}

export type PoseMap = Record<string, { x: number; y: number; z: number }>;

export async function fetchProducts(
  domainId: string = DEFAULT_DOMAIN_ID,
): Promise<CactusProduct[]> {
  const res = await fetch(`${CACTUS_BASE_URL}/recommended`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ domainId }),
  });
  if (!res.ok) throw new Error(`Failed to fetch products: ${res.status}`);
  const json = await res.json();
  return (json.data ?? []) as CactusProduct[];
}

export async function fetchProductPoses(
  skus: string[],
  domainId: string = DEFAULT_DOMAIN_ID,
): Promise<PoseMap> {
  if (skus.length === 0) return {};
  const res = await fetch(`${CACTUS_BASE_URL}/products/positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ domainId, skus }),
  });
  if (!res.ok) throw new Error(`Failed to fetch poses: ${res.status}`);
  return (await res.json()) as PoseMap;
}
