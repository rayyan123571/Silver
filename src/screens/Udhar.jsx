import React, { useEffect, useState } from 'react'
import { useApp } from '../state/store.jsx'
import { fmtMoney, fmtNum } from '../logic/units.js'

const CAT_LABEL = {
  gold_give: 'سونا دیا',
  gold_take: 'سونا لیا',
  cash_give: 'کیش دیا',
  cash_take: 'کیش لیا',
  gold_sell: 'سونا فروخت',
  gold_buy: 'سونا خرید',
  lab_job: 'لیب'
}

export default function Udhar() {
  const { setScreen, hasApi } = useApp()
  const [q, setQ] = useState('')
  const [list, setList] = useState([])
  const [sel, setSel] = useState(null)
  const [ledger, setLedger] = useState({ rows: [], balance_gold: 0, balance_cash: 0 })

  const search = async () => {
    if (!hasApi) return
    setList(await window.api.findCustomers(q))
  }

  useEffect(() => { search() }, [hasApi])

  const open = async (c) => {
    setSel(c)
    if (hasApi) setLedger(await window.api.getCustomerLedger(c.id))
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-panel">
      <div className="flex items-center gap-2 bg-panel border-b border-line px-2 py-2">
        <button className="tab tab-active urdu" onClick={() => setScreen('main')}>← واپس</button>
        <h1 className="urdu text-lg font-bold">ادھار — Customer Accounts</h1>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* customer list */}
        <div className="w-72 border-l border-line bg-white flex flex-col">
          <div className="flex gap-1 p-1 border-b border-line">
            <input className="inp flex-1" placeholder="نام / موبائل" value={q}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
            <button className="btn urdu" onClick={search}>تلاش</button>
          </div>
          <div className="flex-1 overflow-auto">
            {list.map((c) => (
              <div key={c.id}
                className={`px-2 py-1 border-b border-gray-200 cursor-pointer urdu text-[12px] ${sel?.id === c.id ? 'bg-mint' : 'hover:bg-gray-50'}`}
                onClick={() => open(c)}>
                {c.name} {c.mobile ? `— ${c.mobile}` : ''}
              </div>
            ))}
            {list.length === 0 && <div className="urdu text-center text-gray-500 py-4">کوئی گاہک نہیں</div>}
          </div>
        </div>

        {/* ledger */}
        <div className="flex-1 flex flex-col min-w-0">
          {!sel ? (
            <div className="flex-1 flex items-center justify-center urdu text-gray-500">
              گاہک منتخب کریں
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 p-2 border-b border-line bg-white">
                <h2 className="urdu text-lg font-bold">{sel.name}</h2>
                <span className="urdu text-gray-600">{sel.mobile}</span>
                <div className="flex-1" />
                <div className={`px-3 py-1 border border-line font-bold ${ledger.balance_gold >= 0 ? 'bg-mint' : 'bg-red-100'}`}>
                  <span className="urdu">باقی سونا: </span>{fmtNum(ledger.balance_gold)} گرام
                </div>
                <div className={`px-3 py-1 border border-line font-bold ${ledger.balance_cash >= 0 ? 'bg-mint' : 'bg-red-100'}`}>
                  <span className="urdu">باقی کیش: </span>{fmtMoney(ledger.balance_cash)}
                </div>
              </div>
              <div className="flex-1 overflow-auto p-2">
                <table className="w-full text-[12px] border border-line bg-white">
                  <thead className="bg-header">
                    <tr className="urdu">
                      <th className="hdr">تاریخ</th>
                      <th className="hdr">قسم</th>
                      <th className="hdr">دیا / لیا</th>
                      <th className="hdr">خالص سونا</th>
                      <th className="hdr">کیش</th>
                      <th className="hdr">سونا بیلنس</th>
                      <th className="hdr">کیش بیلنس</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.rows.map((r) => (
                      <tr key={r.id} className="border-b border-gray-200">
                        <td className="px-1 text-center">{r.date}</td>
                        <td className="px-1 urdu text-center">{CAT_LABEL[r.category] || r.category}</td>
                        <td className="px-1 urdu text-center">{r.direction === 'out' ? 'دیا' : 'لیا'}</td>
                        <td className="px-1 text-center">{fmtNum(r.khalis_sona)}</td>
                        <td className="px-1 text-center">{r.cash_amount ? fmtMoney(r.cash_amount) : '-'}</td>
                        <td className="px-1 text-center font-semibold">{fmtNum(r.balance_gold)}</td>
                        <td className="px-1 text-center font-semibold">{fmtMoney(r.balance_cash)}</td>
                      </tr>
                    ))}
                    {ledger.rows.length === 0 && (
                      <tr><td colSpan={7} className="text-center urdu py-4 text-gray-500">کوئی لین دین نہیں</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
