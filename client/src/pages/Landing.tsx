import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Landing() {
  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Business Management System</CardTitle>
          <CardDescription>
            Comprehensive ERP solution for inventory, purchase orders, containers, and accounting
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h3 className="font-semibold">Features:</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>Multi-company management with role-based access</li>
              <li>Inventory tracking across multiple locations</li>
              <li>Purchase orders and container management</li>
              <li>Import/export functionality for stock items</li>
              <li>Full accounting with vouchers and ledger accounts</li>
            </ul>
          </div>
          <Button 
            onClick={handleLogin}
            className="w-full"
            size="lg"
            data-testid="button-login"
          >
            Sign In to Continue
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
