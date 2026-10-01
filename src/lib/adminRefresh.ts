// Atualizar o back-office depois de uma alteração.
//
// router.refresh() sozinho não chega: refresca a rota atual, mas o Next
// mantém no cliente a versão já visitada das outras. Depois de mudar um
// registo em Registos, a Grelha continuava a mostrar as horas antigas até
// se recarregar a página à mão.
//
// Primeiro manda invalidar a árvore /admin no servidor, depois refresca.
export async function atualizarAdmin(router: {
  refresh: () => void;
}): Promise<void> {
  try {
    await fetch("/api/admin/revalidar", { method: "POST" });
  } catch {
    // Sem rede o refresh abaixo também não vai longe; não vale a pena
    // interromper a interface por causa disto.
  }
  router.refresh();
}
