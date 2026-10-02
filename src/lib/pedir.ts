// Pedido ao servidor que nunca rebenta.
//
// O fetch LANÇA uma exceção quando a rede falha, em vez de devolver um
// erro. No back-office ninguém a apanhava: a função morria a meio, nada
// era gravado e não aparecia mensagem nenhuma — ficava exatamente como se
// a pessoa não tivesse feito nada. Com a rede lenta, foi assim que se
// perderam registos criados à mão sem ninguém dar por isso.
//
// Aqui uma falha de rede passa a ser uma resposta de erro normal, que os
// ecrãs já sabem mostrar. E há limite de tempo, para uma ligação que
// nunca responde não deixar um botão preso em "a gravar" para sempre.
export const ERRO_SEM_LIGACAO =
  "Sem ligação ao servidor — NÃO foi gravado. Verifica a rede e tenta de novo.";

export async function pedir(
  url: string,
  init?: RequestInit,
  limiteMs = 20_000
): Promise<Response> {
  const controlo = new AbortController();
  const relogio = setTimeout(() => controlo.abort(), limiteMs);
  try {
    return await fetch(url, { ...init, signal: controlo.signal });
  } catch {
    return new Response(JSON.stringify({ error: ERRO_SEM_LIGACAO }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    clearTimeout(relogio);
  }
}
