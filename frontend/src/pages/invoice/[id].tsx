import { useRouter } from 'next/router'
import { useEffect, useMemo, useState } from 'react'
import { ordersAPI } from '@/services/api'

type InvoiceOrder = {
  id: string
  invoiceNumber: string
  createdAt: string
  subtotal: number
  gstAmount: number
  discount: number
  totalAmount: number
  paymentMethod: string
  customer?: { name: string; phone?: string }
  orderItems: Array<{
    id: string
    quantity: number
    price: number
    totalAmount: number
    item: { name: string }
  }>
}

export default function InvoicePage() {
  const router = useRouter()
  const { id } = router.query
  const [order, setOrder] = useState<InvoiceOrder | null>(null)
  const [mode, setMode] = useState<'A4' | 'THERMAL'>('A4')

  useEffect(() => {
    if (!id || typeof id !== 'string') return
    ordersAPI.getOrder(id).then((res) => setOrder(res.data.data.order))
  }, [id])

  const invoiceDate = useMemo(() => {
    if (!order) return ''
    return new Date(order.createdAt).toLocaleString()
  }, [order])

  if (!order) {
    return <div className="p-6">Loading invoice...</div>
  }

  return (
    <div className="bg-gray-100 min-h-screen p-4">
      <div className="max-w-4xl mx-auto mb-4 flex gap-2 print:hidden">
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn btn-secondary" onClick={() => setMode('A4')}>
          A4
        </button>
        <button className="btn btn-secondary" onClick={() => setMode('THERMAL')}>
          Thermal 80mm
        </button>
      </div>

      <div className={`bg-white mx-auto shadow ${mode === 'THERMAL' ? 'w-[302px]' : 'max-w-4xl'} p-6`}>
        <div className="border-b pb-3 mb-4">
          <h1 className="text-xl font-bold">Invoice</h1>
          <p className="text-sm text-gray-600">Invoice No: {order.invoiceNumber}</p>
          <p className="text-sm text-gray-600">Date: {invoiceDate}</p>
        </div>

        <div className="mb-4 text-sm">
          <p>Customer: {order.customer?.name || 'Walk-in Customer'}</p>
          <p>Phone: {order.customer?.phone || '-'}</p>
          <p>Payment: {order.paymentMethod}</p>
        </div>

        <table className="w-full text-sm border mb-4">
          <thead>
            <tr className="bg-gray-50">
              <th className="p-2 text-left">Item</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-right">Price</th>
              <th className="p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {order.orderItems.map((line) => (
              <tr key={line.id} className="border-t">
                <td className="p-2">{line.item.name}</td>
                <td className="p-2 text-right">{line.quantity}</td>
                <td className="p-2 text-right">{line.price.toFixed(2)}</td>
                <td className="p-2 text-right">{line.totalAmount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto w-full max-w-sm text-sm space-y-1">
          <div className="flex justify-between"><span>Subtotal</span><span>{order.subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>GST</span><span>{order.gstAmount.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Discount</span><span>{order.discount.toFixed(2)}</span></div>
          <div className="flex justify-between font-bold border-t pt-2"><span>Total</span><span>{order.totalAmount.toFixed(2)}</span></div>
        </div>
      </div>
    </div>
  )
}
