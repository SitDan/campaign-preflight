import { WIDGET_JS } from "@/mcp/widget-bundle.generated";
import { widgetAsset } from "@/server/widget-asset";

export async function GET(request: Request) {
  return widgetAsset(request, `${WIDGET_JS}\nwindow.__cpLoaded=true;`, "text/javascript; charset=utf-8");
}
