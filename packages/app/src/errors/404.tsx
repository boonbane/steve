import { Card } from "@steve/ui/card";

export default function NotFound() {
  return (
    <Card tone="error">
      <h1>404: Not Found</h1>
      <p>The requested page does not exist.</p>
    </Card>
  );
}
