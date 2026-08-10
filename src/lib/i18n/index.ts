import fr from "./fr.json";
import pt from "./pt.json";

// i18n simples baseado em ficheiros JSON. Para adicionar um idioma:
// 1. criar src/lib/i18n/<código>.json (ex.: en.json) com as mesmas chaves;
// 2. registá-lo em `dictionaries` abaixo;
// 3. guardar o código em profiles.preferred_language.
export const dictionaries = { fr, pt } as const;

export type Locale = keyof typeof dictionaries;
export type FrDict = typeof fr;
export type PtDict = typeof pt;

export function getDictionary<L extends Locale>(
  locale: L
): (typeof dictionaries)[L] {
  return dictionaries[locale];
}
