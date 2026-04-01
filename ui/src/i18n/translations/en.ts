import type { TranslationKeys } from "./ko";

export const en: Record<TranslationKeys, string> = {
  // Layout chrome
  "layout.skipToMain": "Skip to Main Content",
  "layout.closeSidebar": "Close sidebar",
  "layout.documentation": "Documentation",
  "layout.instanceSettings": "Instance settings",
  "layout.switchToLight": "Switch to light mode",
  "layout.switchToDark": "Switch to dark mode",

  // Sidebar navigation
  "sidebar.selectCompany": "Select company",
  "sidebar.newIssue": "New Issue",
  "sidebar.dashboard": "Dashboard",
  "sidebar.inbox": "Inbox",
  "sidebar.issues": "Issues",
  "sidebar.routines": "Routines",
  "sidebar.goals": "Goals",
  "sidebar.org": "Org",
  "sidebar.skills": "Skills",
  "sidebar.costs": "Costs",
  "sidebar.activity": "Activity",
  "sidebar.settings": "Settings",
  "sidebar.section.work": "Work",
  "sidebar.section.company": "Company",

  // Instance sidebar
  "instanceSidebar.title": "Instance Settings",
  "instanceSidebar.general": "General",
  "instanceSidebar.heartbeats": "Heartbeats",
  "instanceSidebar.experimental": "Experimental",
  "instanceSidebar.plugins": "Plugins",

  // Mobile nav
  "mobileNav.home": "Home",
  "mobileNav.issues": "Issues",
  "mobileNav.create": "Create",
  "mobileNav.agents": "Agents",
  "mobileNav.inbox": "Inbox",
  "mobileNav.label": "Mobile navigation",

  // Common
  "common.save": "Save",
  "common.saving": "Saving...",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.create": "Create",
  "common.search": "Search",
  "common.loading": "Loading...",
  "common.error": "Error",
  "common.confirm": "Confirm",
  "common.back": "Back",
  "common.close": "Close",
  "common.add": "Add",
  "common.remove": "Remove",
  "common.update": "Update",
  "common.submit": "Submit",
  "common.yes": "Yes",
  "common.no": "No",
  "common.optional": "Optional",
  "common.required": "Required",
  "common.name": "Name",
  "common.description": "Description",
  "common.status": "Status",
  "common.priority": "Priority",
  "common.assignee": "Assignee",
  "common.createdAt": "Created",
  "common.updatedAt": "Updated",
  "common.actions": "Actions",
  "common.noResults": "No results",
  "common.viewAll": "View all",
  "common.copyToClipboard": "Copy to clipboard",
  "common.copied": "Copied",

  // Pages
  "page.dashboard": "Dashboard",
  "page.inbox": "Inbox",
  "page.issues": "Issues",
  "page.goals": "Goals",
  "page.costs": "Costs",
  "page.activity": "Activity",
  "page.settings": "Settings",
  "page.agents": "Agents",
  "page.projects": "Projects",
  "page.org": "Org",
  "page.skills": "Skills",
  "page.routines": "Routines",

  // Dashboard
  "dashboard.title": "Dashboard",
  "dashboard.noCompany": "Create or select a company to view the dashboard.",
  "dashboard.activeAgents": "Active Agents",
  "dashboard.totalIssues": "Total Issues",
  "dashboard.totalCost": "Total Cost",
  "dashboard.recentActivity": "Recent Activity",
  "dashboard.recentIssues": "Recent Issues",
  "dashboard.runActivity": "Run Activity",
  "dashboard.issueStatus": "Issue Status",
  "dashboard.issuesByPriority": "Issues by Priority",
  "dashboard.successRate": "Success Rate",
  "dashboard.noActivity": "No recent activity",
  "dashboard.noIssues": "No issues yet",

  // Issues
  "issues.title": "Issues",
  "issues.new": "New Issue",
  "issues.empty": "No issues found",
  "issues.filter.all": "All",
  "issues.filter.open": "Open",
  "issues.filter.closed": "Closed",
  "issues.filter.inProgress": "In Progress",
  "issues.status.todo": "Todo",
  "issues.status.inProgress": "In Progress",
  "issues.status.done": "Done",
  "issues.status.cancelled": "Cancelled",
  "issues.priority.urgent": "Urgent",
  "issues.priority.high": "High",
  "issues.priority.medium": "Medium",
  "issues.priority.low": "Low",
  "issues.priority.none": "None",

  // Inbox
  "inbox.title": "Inbox",
  "inbox.empty": "No messages",
  "inbox.markAllRead": "Mark all as read",

  // Agents
  "agents.title": "Agents",
  "agents.new": "New Agent",
  "agents.empty": "No agents yet",
  "agents.status.idle": "Idle",
  "agents.status.running": "Running",
  "agents.status.error": "Error",
  "agents.config.save": "Save config",
  "agents.config.saved": "Saved",
  "agents.wakeup": "Wake up",
  "agents.hire": "Hire",

  // Goals
  "goals.title": "Goals",
  "goals.new": "New Goal",
  "goals.empty": "No goals yet",

  // Projects
  "projects.title": "Projects",
  "projects.new": "New Project",
  "projects.empty": "No projects yet",

  // Costs
  "costs.title": "Costs",
  "costs.empty": "No cost data",

  // Activity
  "activity.title": "Activity",
  "activity.empty": "No activity yet",

  // Settings
  "settings.title": "Settings",
  "settings.general": "General",
  "settings.company": "Company",
  "settings.agents": "Agents",

  // Onboarding
  "onboarding.title": "Welcome to Paperclip",
  "onboarding.createCompany": "Create Company",
  "onboarding.companyName": "Company name",
  "onboarding.companyNamePlaceholder": "My Company",

  // Errors
  "error.notFound": "Page not found",
  "error.unauthorized": "Unauthorized",
  "error.serverError": "Server error",
  "error.tryAgain": "Try again",

  // Time
  "time.justNow": "Just now",
  "time.minutesAgo": "{{count}}m ago",
  "time.hoursAgo": "{{count}}h ago",
  "time.daysAgo": "{{count}}d ago",

  // Heartbeats / Runs
  "runs.title": "Runs",
  "runs.status.running": "Running",
  "runs.status.completed": "Completed",
  "runs.status.failed": "Failed",
  "runs.status.timedOut": "Timed out",
  "runs.liveCount": "{{count}} running",
};
