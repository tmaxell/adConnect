import { ChatWorkspaceProvider } from "../chat-workspace/store/chatWorkspaceStore";
import { AdConnectMock } from "./AdConnectMock";
import { FloatingWidget } from "./FloatingWidget";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { LangProvider, useLang } from "../i18n";

function MainLayoutInner() {
  const { t } = useLang();
  return (
    <AppErrorBoundary title={t("Ошибка интерфейса", "Interface error")}>
      <AdConnectMock />
      <FloatingWidget />
    </AppErrorBoundary>
  );
}

export function MainLayout() {
  return (
    <LangProvider>
      <ChatWorkspaceProvider>
        <MainLayoutInner />
      </ChatWorkspaceProvider>
    </LangProvider>
  );
}
