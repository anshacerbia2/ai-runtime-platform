import { SchemaScreen } from '../../../features/schemas/schema-screen';
import { webConfig } from '../../../server/runtime';

export default function Page() {
  if (!webConfig().local) {
    return (
      <section className="ds-panel entry-card">
        <h1>Local Contract Lab only</h1>
        <p>
          This diagnostic surface is disabled in OIDC deployments. Use Control
          Plane for application administration.
        </p>
      </section>
    );
  }
  return <SchemaScreen />;
}
