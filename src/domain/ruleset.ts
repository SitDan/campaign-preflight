import raw from "../../rules/instagram-feed.json";
import { rulesetSchema, type Ruleset } from "./rules";

/** Référentiel figé au build, validé au chargement. */
export const INSTAGRAM_FEED_RULESET: Ruleset = rulesetSchema.parse(raw);
