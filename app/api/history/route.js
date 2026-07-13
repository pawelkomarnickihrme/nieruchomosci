import { listHistory } from "../../../scraper.js";

export async function GET() {
  return Response.json(await listHistory());
}
