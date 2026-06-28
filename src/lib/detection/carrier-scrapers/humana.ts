import { readFileSync } from 'fs'
import { parseRosterFile } from '@/lib/churn/roster-parser'
import { CarrierScraper } from './base'
import type { Page } from 'playwright-core'
import type { RosterRow } from './base'

export class HumanaScraper extends CarrierScraper {
  carrier = 'humana'
  loginUrl = 'https://agentportal.humana.com/Vantage'

  async doLogin(page: Page, username: string, password: string): Promise<boolean> {
    try {
      // Step 1: Go to agent portal — redirects to SSO login for agents
      await page.goto('https://agentportal.humana.com/Vantage', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      })
      await this.humanDelay(2000, 3000)
      await page.screenshot({ path: 'scripts/debug-step1.png' })
      console.log('[Step1] URL  :', page.url())
      console.log('[Step1] Title:', await page.title())

      // Step 2: Fill credentials on whatever SSO form we landed on
      await page.waitForSelector(
        'input[name="username"], input[id="username"], input[autocomplete="username"]',
        { timeout: 15000 }
      )
      await page.fill('input[name="username"], input[id="username"]', username)
      await this.humanDelay(800, 1200)
      await page.fill('input[type="password"]', password)
      await this.humanDelay(800, 1500)
      await page.screenshot({ path: 'scripts/debug-step2.png' })
      console.log('[Step2] credentials filled')

      // Step 3: Submit
      await page.click('button[type="submit"], button:has-text("Sign in")')
      await this.humanDelay(3000, 5000)
      await page.screenshot({ path: 'scripts/debug-step3.png' })
      console.log('[Step3] URL  :', page.url())
      console.log('[Step3] Title:', await page.title())

      // Step 4: Handle "Select where you want to sign in" modal (Employer / Agent)
      try {
        const agentBtn = await page.$('button:has-text("Agent")')
        if (agentBtn) {
          console.log('[Step4] agent modal visible — clicking Agent')
          await agentBtn.click()
          await this.humanDelay(2000, 3000)
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
        } else {
          console.log('[Step4] no agent modal')
        }
      } catch {
        // No modal
      }
      await page.screenshot({ path: 'scripts/debug-step4.png' })
      console.log('[Step4] URL  :', page.url())
      console.log('[Step4] Title:', await page.title())

      // Verify we landed on Vantage
      const url = page.url()
      if (!url.includes('agentportal.humana.com')) {
        const pageText = (await page.textContent('body')) ?? ''
        if (
          pageText.includes('Verify') ||
          pageText.includes('verification code') ||
          pageText.includes('Enter code')
        ) {
          throw new Error('MFA required for humana')
        }
        return false
      }

      return true
    } catch (err: any) {
      console.error('[HumanaScraper] login error:', err?.message)
      throw err
    }
  }

  async downloadRoster(page: Page): Promise<RosterRow[]> {
    await page.goto('https://agentportal.humana.com/Vantage/MyBusiness', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    })
    await this.humanDelay(2500, 3500)

    await page.click('text="Active Policies", [class*="Active Policies"]')
    await this.humanDelay(2000, 3000)

    await page.waitForSelector('text="Filter Results", text="Active Policies"', {
      timeout: 15000,
    })

    try {
      await page.click('text="Reports"')
      await this.humanDelay(1500, 2000)
    } catch {
      // Already on Reports, or tab not present
    }

    await page.click('text="All Columns"')
    await this.humanDelay(1000, 1500)

    await page.click('text=".CSV", label:has-text("CSV")')
    await this.humanDelay(1000, 1500)

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.click('button:has-text("Export"), text="Export"'),
    ])

    const downloadPath = await download.path()
    if (!downloadPath) throw new Error('[HumanaScraper] Download failed — no temp file path returned')

    const raw = readFileSync(downloadPath)
    const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    return parseRosterFile(ab, 'humana')
  }
}
