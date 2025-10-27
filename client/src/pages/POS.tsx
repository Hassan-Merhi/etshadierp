import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Minus, Trash2, CreditCard, Banknote, Smartphone } from "lucide-react";

//todo: remove mock functionality
const mockProducts = [
  { id: "1", name: "Premium Cotton Bales", price: 450, stock: 45, barcode: "BAL001" },
  { id: "2", name: "Denim Mix Bales", price: 380, stock: 32, barcode: "BAL002" },
  { id: "3", name: "Designer Labels Mix", price: 650, stock: 18, barcode: "BAL003" },
  { id: "4", name: "Summer Collection", price: 420, stock: 28, barcode: "BAL004" },
  { id: "5", name: "Winter Apparel Mix", price: 520, stock: 22, barcode: "BAL005" },
  { id: "6", name: "Kids Clothing Bales", price: 350, stock: 40, barcode: "BAL006" },
];

export default function POS() {
  const [cart, setCart] = useState<Array<{ id: string; name: string; price: number; quantity: number }>>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);

  const addToCart = (product: typeof mockProducts[0]) => {
    const existing = cart.find((item) => item.id === product.id);
    if (existing) {
      setCart(cart.map((item) =>
        item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
      ));
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(cart.map((item) =>
      item.id === id ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item
    ).filter((item) => item.quantity > 0));
  };

  const removeItem = (id: string) => {
    setCart(cart.filter((item) => item.id !== id));
  };

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * 0.08;
  const total = subtotal + tax;

  const filteredProducts = mockProducts.filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.barcode.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-8rem)]">
      <div className="flex-1 flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Search products by name or barcode..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 h-12"
            data-testid="input-product-search"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredProducts.map((product) => (
              <Card
                key={product.id}
                className="p-3 cursor-pointer hover-elevate active-elevate-2"
                onClick={() => addToCart(product)}
                data-testid={`card-product-${product.id}`}
              >
                <div className="aspect-square bg-muted rounded-md mb-2 flex items-center justify-center">
                  <span className="text-xs text-muted-foreground font-mono">
                    {product.barcode}
                  </span>
                </div>
                <h4 className="text-sm font-medium line-clamp-2 mb-1">
                  {product.name}
                </h4>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold font-mono">
                    ${product.price}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {product.stock} in stock
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <Card className="w-full lg:w-96 flex flex-col p-4">
        <h2 className="text-lg font-semibold mb-4">Current Sale</h2>

        <div className="flex-1 overflow-y-auto space-y-2 mb-4">
          {cart.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm">Cart is empty</p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 p-3 border rounded-md"
                data-testid={`cart-item-${item.id}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    ${item.price} each
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    onClick={() => updateQuantity(item.id, -1)}
                    data-testid={`button-decrease-${item.id}`}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="text-sm font-mono w-8 text-center">
                    {item.quantity}
                  </span>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    onClick={() => updateQuantity(item.id, 1)}
                    data-testid={`button-increase-${item.id}`}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => removeItem(item.id)}
                    data-testid={`button-remove-${item.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t pt-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-mono">${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tax (8%)</span>
            <span className="font-mono">${tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-lg font-semibold border-t pt-3">
            <span>Total</span>
            <span className="font-mono" data-testid="text-total">
              ${total.toFixed(2)}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2">
            <Button
              variant={paymentMethod === "cash" ? "default" : "outline"}
              onClick={() => setPaymentMethod("cash")}
              className="gap-2"
              data-testid="button-payment-cash"
            >
              <Banknote className="h-4 w-4" />
              Cash
            </Button>
            <Button
              variant={paymentMethod === "card" ? "default" : "outline"}
              onClick={() => setPaymentMethod("card")}
              className="gap-2"
              data-testid="button-payment-card"
            >
              <CreditCard className="h-4 w-4" />
              Card
            </Button>
            <Button
              variant={paymentMethod === "mobile" ? "default" : "outline"}
              onClick={() => setPaymentMethod("mobile")}
              className="gap-2"
              data-testid="button-payment-mobile"
            >
              <Smartphone className="h-4 w-4" />
              Mobile
            </Button>
          </div>

          <Button
            className="w-full h-12"
            disabled={cart.length === 0 || !paymentMethod}
            onClick={() => {
              console.log("Sale completed:", { cart, paymentMethod, total });
              setCart([]);
              setPaymentMethod(null);
            }}
            data-testid="button-complete-sale"
          >
            Complete Sale
          </Button>
        </div>
      </Card>
    </div>
  );
}
