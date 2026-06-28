
'use client';

import { useAppStore, type Language } from './store';

export const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
];

export const translations = {
  en: {
    common: {
      dashboard: "Retention Command Center",
      members: "Book of Business",
      accounting: "Commissions",
      fax: "VCC Tool",
      checkins: "AI Check-ins",
      ghl: "GHL Integration",
      vault: "Credential Vault",
      ai: "Retention AI",
      settings: "Settings",
      login: "Log In",
      signup: "Get Access",
      trial: "Start 14-Day Free Trial",
      demo: "Launch Demo",
    },
    landing: {
      heroTitle: "Retention on Autopilot. Stop Churn Before It Starts.",
      heroSubtitle: "The first autonomous Medicare retention platform that detects disenrollment attempts in carrier portals and triggers GHL alerts in real-time.",
      badge: "AGENT GRADE RETENTION OS",
    },
    dashboard: {
      title: "Retention Command Center",
      subtitle: "Autonomous Carrier Portal Monitoring",
      bookOfBusiness: "Active Clients",
      retentionScore: "Avg Retention Rate",
      switchAlerts: "Portal Change Alerts",
      pendingFaxes: "Pending VCC Forms",
    }
  },
  es: {
    common: {
      dashboard: "Centro de Mando",
      members: "Lista de Miembros",
      accounting: "Contabilidad",
      fax: "Fax VCC",
      checkins: "Chequeos IA",
      ghl: "Sincronización CRM",
      vault: "Bóveda",
      ai: "IA de Retención",
      settings: "Ajustes",
      login: "Iniciar Sesión",
      signup: "Obtener Acceso",
      trial: "Iniciar Prueba Gratuita de 14 Días",
      demo: "Lanzar Demo",
    },
    landing: {
      heroTitle: "Captura Cada Intento de Cambio.",
      heroSubtitle: "La primera plataforma autónoma de Medicare que detiene el abandono detectando intentos de desinscripción en tiempo real.",
      badge: "SISTEMA OPERATIVO DE RETENCIÓN PARA AGENTES",
    },
    dashboard: {
      title: "Centro de Mando de Retención",
      subtitle: "Monitoreo Autónomo de Medicare",
      bookOfBusiness: "Cartera de Clientes",
      retentionScore: "Puntuación Media de Retención",
      switchAlerts: "Alertas de Cambio CMS",
      pendingFaxes: "Faxes VCC Pendientes",
    }
  },
  fr: {
    common: {
      dashboard: "Centre de Commande",
      members: "Liste des Membres",
      accounting: "Comptabilité",
      fax: "Fax VCC",
      checkins: "Suivis IA",
      ghl: "Sync CRM",
      vault: "Coffre-fort",
      ai: "IA de Rétention",
      settings: "Paramètres",
      login: "Connexion",
      signup: "S'inscrire",
      trial: "Essai Gratuit de 14 Jours",
      demo: "Lancer Démo",
    },
    landing: {
      heroTitle: "Capturez Chaque Tentative de Changement.",
      heroSubtitle: "La première plateforme Medicare autonome qui stoppe l'attrition en détectant les tentatives de désinscription en temps réel.",
      badge: "OS DE RÉTENTION QUALITÉ AGENT",
    },
    dashboard: {
      title: "Centre de Commande de Rétention",
      subtitle: "Surveillance Autonome Medicare",
      bookOfBusiness: "Portefeuille Clients",
      retentionScore: "Score Moyen de Rétention",
      switchAlerts: "Alertes de Changement CMS",
      pendingFaxes: "Faxes VCC en Attente",
    }
  },
  de: {
    common: {
      dashboard: "Kommandozentrale",
      members: "Mitgliederliste",
      accounting: "Buchhaltung",
      fax: "VCC Fax",
      checkins: "KI-Check-ins",
      ghl: "CRM Sync",
      vault: "Tresor",
      ai: "Retentions-KI",
      settings: "Einstellungen",
      login: "Anmelden",
      signup: "Zugang Erhalten",
      trial: "14 Tage Kostenlos Testen",
      demo: "Demo Starten",
    },
    landing: {
      heroTitle: "Jeden Wechsel-Trigger Erfassen.",
      heroSubtitle: "Die erste autonome Medicare-Plattform, die Abwanderung durch Erkennung von Abmeldungsversuchen in Echtzeit stoppt.",
      badge: "AGENTEN-GRAD RETENTION OS",
    },
    dashboard: {
      title: "Retentions-Kommandozentrale",
      subtitle: "Autonome Medicare-Überwachung",
      bookOfBusiness: "Geschäftsbuch",
      retentionScore: "Durchschn. Retentions-Score",
      switchAlerts: "CMS Wechsel-Warnungen",
      pendingFaxes: "Ausstehende VCC-Faxe",
    }
  },
  zh: {
    common: {
      dashboard: "指挥中心",
      members: "成员名册",
      accounting: "会计",
      fax: "VCC 传真",
      checkins: "AI 签到",
      ghl: "CRM 同步",
      vault: "保险库",
      ai: "留存 AI",
      settings: "设置",
      login: "登录",
      signup: "获取访问权限",
      trial: "开始 14 天免费试用",
      demo: "启动演示",
    },
    landing: {
      heroTitle: "捕捉每一次转换触发器。",
      heroSubtitle: "首个通过实时检测退保尝试来防止客户流失的自主医疗保险平台。",
      badge: "代理级留存操作系统",
    },
    dashboard: {
      title: "留存指挥中心",
      subtitle: "自主医疗保险监测",
      bookOfBusiness: "业务账簿",
      retentionScore: "平均留存分数",
      switchAlerts: "CMS 转换警报",
      pendingFaxes: "待处理 VCC 传真",
    }
  },
  ja: {
    common: {
      dashboard: "コマンドセンター",
      members: "メンバー名簿",
      accounting: "会計",
      fax: "VCC ファックス",
      checkins: "AI チェックイン",
      ghl: "CRM 同期",
      vault: "保管庫",
      ai: "リテンション AI",
      settings: "設定",
      login: "ログイン",
      signup: "アクセスを取得",
      trial: "14日間の無料トライアルを開始",
      demo: "デモを起動",
    },
    landing: {
      heroTitle: "すべてのスイッチトリガーをキャプチャ。",
      heroSubtitle: "退会試行をリアルタイムで検出し、顧客離れを止める最初の自律型メディケアプラットフォーム。",
      badge: "エージェントグレードのリテンションOS",
    },
    dashboard: {
      title: "リテンションコマンドセンター",
      subtitle: "自律型メディケアモニタリング",
      bookOfBusiness: "保有契約",
      retentionScore: "平均リテンションスコア",
      switchAlerts: "CMS スイッチアラート",
      pendingFaxes: "保留中の VCC ファックス",
    }
  },
  pt: {
    common: {
      dashboard: "Centro de Comando",
      members: "Lista de Membros",
      accounting: "Contabilidade",
      fax: "Fax VCC",
      checkins: "Check-ins IA",
      ghl: "Sincronização CRM",
      vault: "Cofre",
      ai: "IA de Retenção",
      settings: "Configurações",
      login: "Entrar",
      signup: "Obter Acesso",
      trial: "Iniciar Teste Grátis de 14 Dias",
      demo: "Lançar Demo",
    },
    landing: {
      heroTitle: "Capture Cada Gatilho de Mudança.",
      heroSubtitle: "A primeira plataforma autônoma de Medicare que interrompe a rotatividade detectando tentativas de desfiliação em tempo real.",
      badge: "SISTEMA OPERACIONAL DE RETENÇÃO PARA AGENTES",
    },
    dashboard: {
      title: "Centro de Comando de Retenção",
      subtitle: "Monitoramento Autônomo de Medicare",
      bookOfBusiness: "Carteira de Negócios",
      retentionScore: "Pontuação Média de Retenção",
      switchAlerts: "Alertas de Mudança CMS",
      pendingFaxes: "Faxes VCC Pendentes",
    }
  },
  it: {
    common: {
      dashboard: "Centro di Comando",
      members: "Elenco Membri",
      accounting: "Contabilità",
      fax: "Fax VCC",
      checkins: "Check-in IA",
      ghl: "Sincronizzazione CRM",
      vault: "Vault",
      ai: "IA di Ritenzione",
      settings: "Impostazioni",
      login: "Accedi",
      signup: "Ottieni Accesso",
      trial: "Inizia Prova Gratuita di 14 Giorni",
      demo: "Avvia Demo",
    },
    landing: {
      heroTitle: "Cattura Ogni Trigger di Cambio.",
      heroSubtitle: "La prima piattaforma Medicare autonoma che ferma l'abbandono rilevando i tentativi di disiscrizione in tempo reale.",
      badge: "OS DI RITENZIONE GRADO AGENTE",
    },
    dashboard: {
      title: "Centro di Comando Ritenzione",
      subtitle: "Monitoraggio Autonomo Medicare",
      bookOfBusiness: "Portafoglio Clienti",
      retentionScore: "Punteggio Medio di Ritenzione",
      switchAlerts: "Avvisi di Cambio CMS",
      pendingFaxes: "Fax VCC in Sospeso",
    }
  },
  ru: {
    common: {
      dashboard: "Командный центр",
      members: "Список участников",
      accounting: "Бухгалтерия",
      fax: "Факс VCC",
      checkins: "ИИ-проверки",
      ghl: "Синхронизация CRM",
      vault: "Хранилище",
      ai: "ИИ удержания",
      settings: "Настройки",
      login: "Войти",
      signup: "Получить доступ",
      trial: "14-дневная бесплатная версия",
      demo: "Запустить демо",
    },
    landing: {
      heroTitle: "Фиксируйте каждый триггер смены плана.",
      heroSubtitle: "Первая автономная платформа Medicare, которая останавливает отток, обнаруживая попытки отказа от страховки в реальном времени.",
      badge: "ОС УДЕРЖАНИЯ АГЕНТСКОГО УРОВНЯ",
    },
    dashboard: {
      title: "Командный центр удержания",
      subtitle: "Автономный мониторинг Medicare",
      bookOfBusiness: "Клиентская база",
      retentionScore: "Средний балл удержания",
      switchAlerts: "Оповещения CMS о смене",
      pendingFaxes: "Ожидающие факсы VCC",
    }
  },
  ar: {
    common: {
      dashboard: "مركز القيادة",
      members: "قائمة الأعضاء",
      accounting: "المحاسبة",
      fax: "فاكس VCC",
      checkins: "متابعة الذكاء الاصطناعي",
      ghl: "مزامنة CRM",
      vault: "الخزنة",
      ai: "ذكاء الاحتفاظ",
      settings: "الإعدادات",
      login: "تسجيل الدخول",
      signup: "الحصول على الوصول",
      trial: "ابدأ تجربة مجانية لمدة 14 يومًا",
      demo: "تشغيل العرض التجريبي",
    },
    landing: {
      heroTitle: "التقط كل محفز للتغيير.",
      heroSubtitle: "أول منصة Medicare مستقلة توقف التغيير عن طريق الكشف عن محاولات إلغاء الاشتراك في الوقت الفعلي.",
      badge: "نظام تشغيل الاحتفاظ بدرجة وكيل",
    },
    dashboard: {
      title: "مركز قيادة الاحتفاظ",
      subtitle: "مراقبة Medicare المستقلة",
      bookOfBusiness: "سجل الأعمال",
      retentionScore: "متوسط درجة الاحتفاظ",
      switchAlerts: "تنبيهات تغيير CMS",
      pendingFaxes: "فاكسات VCC المعلقة",
    }
  }
};

export function useTranslation() {
  const { language } = useAppStore();
  
  const t = (path: string) => {
    const keys = path.split('.');
    let result: any = translations[language];
    
    for (const key of keys) {
      if (result && result[key]) {
        result = result[key];
      } else {
        // Fallback to English if key missing
        let fallback: any = translations['en'];
        for (const fkey of keys) {
          if (fallback && fallback[fkey]) {
            fallback = fallback[fkey];
          } else {
            return path;
          }
        }
        return fallback;
      }
    }
    return result;
  };

  return { t, language };
}
