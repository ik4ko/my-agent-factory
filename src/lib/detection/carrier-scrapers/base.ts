import chromium from '@sparticuz/chromium'
import type { Page } from 'playwright-core'
import type { RosterRow } from '@/lib/churn/roster-parser'

export type { RosterRow }

const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--window-size=1366,768',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
  '--hide-scrollbars',
  '--mute-audio',
]

export abstract class CarrierScraper {
  abstract carrier: string
  abstract loginUrl: string

  async scrapeRoster(username: string, password: string): Promise<RosterRow[]> {
    // Dynamic imports keep playwright-extra and the stealth plugin out of the
    // module-level bundle so Next.js build doesn't try to statically analyse them.
    const { chromium: playwrightChromium } = await import('playwright-extra')
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default
    playwrightChromium.use(StealthPlugin())

    const executablePath = await chromium.executablePath()
    const browser = await playwrightChromium.launch({
      args: [...chromium.args, ...LAUNCH_ARGS],
      executablePath,
      headless: (chromium as any).headless ?? true,
    })
    try {
      const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        javaScriptEnabled: true,
      })
      const page = await ctx.newPage()

      const loggedIn = await this.doLogin(page, username, password)
      if (!loggedIn) {
        await browser.close()
        throw new Error(`Login failed or MFA required for ${this.carrier}`)
      }

      const rows = await this.downloadRoster(page)
      await browser.close()
      return rows
    } catch (err) {
      await browser.close()
      throw err
    }
  }

  abstract doLogin(page: Page, username: string, password: string): Promise<boolean>
  abstract downloadRoster(page: Page): Promise<RosterRow[]>

  protected async humanDelay(min = 800, max = 2500): Promise<void> {
    const ms = Math.random() * (max - min) + min
    await new Promise(r => setTimeout(r, ms))
  }

  protected async scrapeTable(page: Page): Promise<RosterRow[]> {
    return page.evaluate(() => {
      const rows: Array<Record<string, string | undefined>> = []
      document.querySelectorAll('table tbody tr').forEach(row => {
        const cells = row.querySelectorAll('td')
        rows.push({
          full_name:      cells[0]?.textContent?.trim(),
          member_id:      cells[1]?.textContent?.trim(),
          plan_name:      cells[2]?.textContent?.trim(),
          effective_date: cells[3]?.textContent?.trim(),
          status:         cells[4]?.textContent?.trim(),
        })
      })
      return rows
    }) as unknown as RosterRow[]
  }
}
