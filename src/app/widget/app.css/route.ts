import { WIDGET_CSS } from "@/mcp/widget-bundle.generated";
import { widgetAsset } from "@/server/widget-asset";

export async function GET(request: Request) {
  return widgetAsset(request, WIDGET_CSS, "text/css; charset=utf-8");
}
