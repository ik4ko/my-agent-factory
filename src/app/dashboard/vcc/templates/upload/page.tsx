"use client"

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CollectionSidebar } from '@/components/collection-sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
  Upload, ChevronRight, FileText, Loader2, CheckCircle,
  Eye, Save, Info, ArrowLeft
} from 'lucide-react'
import { uploadTemplatePDF, saveTemplate, testFillTemplate, type FieldDef } from '@/app/actions/vcc-templates'
import Link from 'next/link'

const CARRIERS = [
  { value: 'humana', label: 'Humana' },
  { value: 'uhc', label: 'United Healthcare' },
  { value: 'aetna', label: 'Aetna' },
  { value: 'bcbs', label: 'Blue Cross Blue Shield' },
  { value: 'wellcare', label: 'Wellcare' },
  { value: 'cigna', label: 'Cigna' },
  { value: 'other', label: 'Other' },
]

const DEFAULT_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'client_name', label: 'Client Name' },
  { key: 'client_dob', label: 'Client DOB' },
  { key: 'medicare_id', label: 'Medicare ID (hash only)' },
  { key: 'doctor_name', label: 'Doctor Name' },
  { key: 'doctor_fax', label: 'Doctor Fax' },
  { key: 'broker_npn', label: 'Broker NPN' },
  { key: 'broker_name', label: 'Broker Name' },
  { key: 'submission_date', label: 'Submission Date' },
]

interface FieldRow {
  key: string
  label: string
  page: string
  x: string
  y: string
  size: string
}

function Step({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${active ? 'text-primary' : done ? 'text-emerald-600' : 'text-muted-foreground'}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black
        ${active ? 'bg-primary text-white' : done ? 'bg-emerald-500 text-white' : 'bg-muted'}`}>
        {done ? <CheckCircle className="w-4 h-4" /> : n}
      </div>
      <span className="text-[10px] font-black uppercase tracking-widest hidden sm:block">{label}</span>
    </div>
  )
}

export default function UploadTemplatePage() {
  const router = useRouter()
  const { toast } = useToast()
  const [step, setStep] = useState(1)
  const [isPending, startTransition] = useTransition()

  // Step 1 state
  const [carrier, setCarrier] = useState('')
  const [year, setYear] = useState('2026')
  const [formName, setFormName] = useState('')
  const [version, setVersion] = useState('1')
  const [file, setFile] = useState<File | null>(null)
  const [storagePath, setStoragePath] = useState('')

  // Step 2 state
  const [fields, setFields] = useState<FieldRow[]>(
    DEFAULT_FIELDS.map(f => ({ ...f, page: '1', x: '', y: '', size: '10' }))
  )

  function updateField(index: number, col: keyof FieldRow, val: string) {
    setFields(prev => prev.map((f, i) => i === index ? { ...f, [col]: val } : f))
  }

  function buildFieldMap(): Record<string, FieldDef> {
    const map: Record<string, FieldDef> = {}
    for (const f of fields) {
      if (f.x && f.y) {
        map[f.key] = {
          page: parseInt(f.page) || 1,
          x: parseFloat(f.x),
          y: parseFloat(f.y),
          size: parseFloat(f.size) || 10,
        }
      }
    }
    return map
  }

  function handleUpload() {
    if (!carrier || !file || !formName) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Fill in all required fields.' })
      return
    }
    startTransition(async () => {
      const fd = new FormData()
      fd.set('file', file)
      fd.set('carrier', carrier)
      fd.set('year', year)
      fd.set('version', version)
      const res = await uploadTemplatePDF(fd)
      if (res.error) {
        toast({ variant: 'destructive', title: 'Upload failed', description: res.error })
        return
      }
      setStoragePath(res.storagePath!)
      toast({ title: 'PDF Uploaded', description: 'Now map the form fields.' })
      setStep(2)
    })
  }

  function handlePreviewFill() {
    const fieldMap = buildFieldMap()
    if (Object.keys(fieldMap).length === 0) {
      toast({ variant: 'destructive', title: 'No fields mapped', description: 'Enter at least one X/Y coordinate.' })
      return
    }
    startTransition(async () => {
      const res = await testFillTemplate({
        templateId: `${carrier}_${year}_v${version}`,
        storagePath,
        fieldMap,
        brokerNpn: 'TEST-NPN-001',
        brokerName: 'Test Broker',
      })
      if (res.error) {
        toast({ variant: 'destructive', title: 'Preview failed', description: res.error })
        return
      }
      const bytes = Uint8Array.from(atob(res.pdfBase64!), c => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `preview-${carrier}-${year}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: 'Preview Downloaded', description: 'Verify field placement, then save.' })
    })
  }

  function handleSave() {
    const fieldMap = buildFieldMap()
    startTransition(async () => {
      const res = await saveTemplate({
        carrier,
        year: parseInt(year),
        formName,
        version: parseInt(version),
        fieldMap,
        storagePath,
      })
      if (res.error) {
        toast({ variant: 'destructive', title: 'Save failed', description: res.error })
        return
      }
      setStep(3)
      toast({ title: 'Template Saved', description: 'Ready for VCC submissions.' })
      setTimeout(() => router.push('/dashboard/vcc/templates'), 1500)
    })
  }

  return (
    <div className="flex h-full w-full bg-background">
      <CollectionSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-border px-8 flex items-center justify-between bg-white/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild className="rounded-xl">
              <Link href="/dashboard/vcc/templates"><ArrowLeft className="w-4 h-4" /></Link>
            </Button>
            <div>
              <h1 className="text-xl font-black text-foreground uppercase tracking-tight">Upload Template</h1>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">VCC PDF Field Mapper</p>
            </div>
          </div>
          {/* Step progress */}
          <div className="flex items-center gap-3">
            <Step n={1} label="Upload" active={step === 1} done={step > 1} />
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
            <Step n={2} label="Map Fields" active={step === 2} done={step > 2} />
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
            <Step n={3} label="Save" active={step === 3} done={false} />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {/* -- STEP 1: Upload -- */}
          {step === 1 && (
            <div className="max-w-lg mx-auto space-y-6">
              <Card className="rounded-3xl">
                <CardHeader><CardTitle className="text-sm font-black uppercase tracking-widest">Form Details</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest">Carrier *</Label>
                      <Select value={carrier} onValueChange={setCarrier}>
                        <SelectTrigger className="rounded-2xl h-11 font-bold text-xs">
                          <SelectValue placeholder="Select carrier..." />
                        </SelectTrigger>
                        <SelectContent>
                          {CARRIERS.map(c => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest">Year *</Label>
                      <Select value={year} onValueChange={setYear}>
                        <SelectTrigger className="rounded-2xl h-11 font-bold text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2026">2026</SelectItem>
                          <SelectItem value="2027">2027</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Form Name *</Label>
                    <Input
                      placeholder="e.g. Humana Plan Change Request"
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      className="rounded-2xl h-11 font-bold text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Version</Label>
                    <Input
                      placeholder="1"
                      value={version}
                      onChange={e => setVersion(e.target.value)}
                      className="rounded-2xl h-11 font-bold text-xs w-24"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase tracking-widest">PDF File *</Label>
                    <div
                      className="border-2 border-dashed border-border rounded-2xl p-8 text-center cursor-pointer hover:bg-muted/20 transition-colors"
                      onClick={() => document.getElementById('pdf-input')?.click()}
                    >
                      {file ? (
                        <div className="flex items-center justify-center gap-3">
                          <FileText className="w-6 h-6 text-primary" />
                          <div className="text-left">
                            <p className="text-sm font-black">{file.name}</p>
                            <p className="text-[10px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
                          <p className="text-sm font-black uppercase tracking-widest text-muted-foreground">Drop PDF here or click</p>
                        </div>
                      )}
                      <input
                        id="pdf-input"
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={e => setFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleUpload}
                    disabled={isPending || !carrier || !file || !formName}
                    className="w-full h-12 rounded-2xl bg-primary text-white font-black uppercase tracking-widest text-[10px]"
                  >
                    {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                    {isPending ? 'Uploading...' : 'Upload & Continue'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* -- STEP 2: Field Mapper -- */}
          {step === 2 && (
            <div className="max-w-4xl mx-auto space-y-6">
              <Card className="rounded-2xl border-amber-200 bg-amber-50/50">
                <CardContent className="p-4 flex items-start gap-3">
                  <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[10px] font-bold text-amber-800 leading-relaxed">
                    Open the PDF in your viewer, hover over each field, and note the X/Y coordinates from the status bar.
                    PDF coordinates start from the <strong>bottom-left corner</strong>. Typical values: X 72-540, Y 72-720 for letter-size forms.
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-3xl">
                <CardHeader className="pb-3 flex-row items-center justify-between">
                  <CardTitle className="text-sm font-black uppercase tracking-widest">Field Coordinates</CardTitle>
                  <Badge variant="outline" className="font-black uppercase text-[9px]">
                    {storagePath.split('/').pop()}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground w-48">Field</th>
                          <th className="text-left py-2 px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground w-20">Page</th>
                          <th className="text-left py-2 px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground w-24">X</th>
                          <th className="text-left py-2 px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground w-24">Y</th>
                          <th className="text-left py-2 px-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground w-20">Size</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {fields.map((f, i) => (
                          <tr key={f.key} className="hover:bg-muted/20 transition-colors">
                            <td className="py-2 px-3">
                              <div>
                                <p className="font-black text-[11px]">{f.label}</p>
                                <p className="font-mono text-[9px] text-muted-foreground">{f.key}</p>
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                value={f.page}
                                onChange={e => updateField(i, 'page', e.target.value)}
                                className="h-8 w-14 rounded-lg text-center font-mono text-xs"
                                placeholder="1"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                value={f.x}
                                onChange={e => updateField(i, 'x', e.target.value)}
                                className="h-8 w-20 rounded-lg font-mono text-xs"
                                placeholder="72"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                value={f.y}
                                onChange={e => updateField(i, 'y', e.target.value)}
                                className="h-8 w-20 rounded-lg font-mono text-xs"
                                placeholder="680"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <Input
                                value={f.size}
                                onChange={e => updateField(i, 'size', e.target.value)}
                                className="h-8 w-16 rounded-lg font-mono text-xs"
                                placeholder="10"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex gap-3 mt-6 pt-4 border-t border-border">
                    <Button
                      variant="outline"
                      onClick={handlePreviewFill}
                      disabled={isPending}
                      className="h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest gap-2"
                    >
                      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                      Preview Fill
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={isPending}
                      className="flex-1 h-11 rounded-2xl bg-primary text-white font-black uppercase text-[10px] tracking-widest gap-2"
                    >
                      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {isPending ? 'Saving...' : 'Save Template'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* -- STEP 3: Done -- */}
          {step === 3 && (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-emerald-500" />
              </div>
              <div>
                <p className="text-xl font-black uppercase tracking-tight text-emerald-600">Template Saved</p>
                <p className="text-sm text-muted-foreground mt-1">Ready for VCC submissions. Redirecting...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
