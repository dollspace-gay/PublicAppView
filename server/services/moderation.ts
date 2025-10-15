import { storage } from '../storage';
import { labelService } from './label';
import type {
  InsertModerationReport,
  ModerationReport,
  InsertModerationAction,
  ModerationAction,
  InsertModeratorAssignment,
  ModeratorAssignment,
} from '@shared/schema';

export class ModerationService {
  async createReport(params: {
    subject: string;
    subjectType: 'post' | 'account' | 'message';
    reportType:
      | 'spam'
      | 'violation'
      | 'misleading'
      | 'sexual'
      | 'rude'
      | 'other';
    reason?: string;
    reporterDid: string;
  }): Promise<ModerationReport> {
    const report: InsertModerationReport = {
      subject: params.subject,
      subjectType: params.subjectType,
      reportType: params.reportType,
      reason: params.reason,
      reporterDid: params.reporterDid,
      status: 'pending',
    };

    const createdReport = await storage.createModerationReport(report);

    await this.checkAutomatedEscalation(createdReport);

    return createdReport;
  }

  async getReport(id: number): Promise<ModerationReport | undefined> {
    return await storage.getModerationReport(id);
  }

  async getReportsByStatus(
    status: string,
    limit?: number
  ): Promise<ModerationReport[]> {
    return await storage.getModerationReportsByStatus(status, limit);
  }

  async getPendingReports(limit = 50): Promise<ModerationReport[]> {
    return await this.getReportsByStatus('pending', limit);
  }

  async getReviewQueue(limit = 50): Promise<ModerationReport[]> {
    return await this.getReportsByStatus('under_review', limit);
  }

  async assignModerator(
    reportId: number,
    moderatorDid: string
  ): Promise<ModeratorAssignment> {
    await storage.updateModerationReportStatus(reportId, 'under_review');

    const assignment: InsertModeratorAssignment = {
      reportId,
      moderatorDid,
    };

    return await storage.assignModerator(assignment);
  }

  async takeAction(params: {
    reportId: number;
    actionType:
      | 'label_applied'
      | 'content_removed'
      | 'account_suspended'
      | 'dismissed'
      | 'escalated';
    moderatorDid: string;
    resolutionNotes?: string;
    labelValue?: string;
    labelSrc?: string;
  }): Promise<ModerationAction> {
    const report = await storage.getModerationReport(params.reportId);
    if (!report) {
      throw new Error(`Report ${params.reportId} not found`);
    }

    let labelUri: string | undefined;

    if (
      params.actionType === 'label_applied' &&
      params.labelValue &&
      params.labelSrc
    ) {
      const label = await labelService.applyLabel({
        src: params.labelSrc,
        subject: report.subject,
        val: params.labelValue,
      });
      labelUri = label.uri;
    }

    const action: InsertModerationAction = {
      reportId: params.reportId,
      actionType: params.actionType,
      moderatorDid: params.moderatorDid,
      resolutionNotes: params.resolutionNotes,
      labelUri,
    };

    const createdAction = await storage.createModerationAction(action);

    // Map action type to correct terminal status
    if (params.actionType !== 'escalated') {
      const statusMap: Record<string, string> = {
        dismissed: 'dismissed',
        label_applied: 'resolved',
        content_removed: 'resolved',
        account_suspended: 'resolved',
      };
      const newStatus = statusMap[params.actionType] || 'resolved';
      await storage.updateModerationReportStatus(params.reportId, newStatus);
    }

    const assignments = await storage.getModeratorAssignmentsByReport(
      params.reportId
    );
    for (const assignment of assignments) {
      if (!assignment.completedAt) {
        await storage.completeModeratorAssignment(assignment.id);
      }
    }

    return createdAction;
  }

  async dismissReport(
    reportId: number,
    moderatorDid: string,
    reason?: string
  ): Promise<ModerationAction> {
    return await this.takeAction({
      reportId,
      actionType: 'dismissed',
      moderatorDid,
      resolutionNotes: reason,
    });
  }

  async escalateReport(
    reportId: number,
    moderatorDid: string,
    reason?: string
  ): Promise<ModerationAction> {
    await storage.updateModerationReportStatus(reportId, 'under_review');

    return await this.takeAction({
      reportId,
      actionType: 'escalated',
      moderatorDid,
      resolutionNotes: reason,
    });
  }

  async getReportHistory(reportId: number): Promise<{
    report: ModerationReport | undefined;
    actions: ModerationAction[];
    assignments: ModeratorAssignment[];
  }> {
    const report = await storage.getModerationReport(reportId);
    const actions = await storage.getModerationActionsByReport(reportId);
    const assignments = await storage.getModeratorAssignmentsByReport(reportId);

    return { report, actions, assignments };
  }

  async getModeratorWorkload(moderatorDid: string): Promise<{
    activeAssignments: ModeratorAssignment[];
    totalActions: ModerationAction[];
  }> {
    const activeAssignments = await storage.getModeratorAssignmentsByModerator(
      moderatorDid,
      false, // Don't include completed
      100
    );

    const totalActions = await storage.getModerationActionsByModerator(
      moderatorDid,
      100
    );

    return { activeAssignments, totalActions };
  }

  private async checkAutomatedEscalation(
    report: ModerationReport
  ): Promise<void> {
    const existingReports = await storage.getModerationReportsBySubject(
      report.subject
    );

    const pendingOrReviewCount = existingReports.filter(
      (r) => r.status === 'pending' || r.status === 'under_review'
    ).length;

    if (pendingOrReviewCount >= 3) {
      await storage.updateModerationReportStatus(report.id, 'under_review');

      const spamLikeTypes = ['spam', 'violation'];
      if (spamLikeTypes.includes(report.reportType)) {
        await labelService.applyLabel({
          src: 'did:plc:system',
          subject: report.subject,
          val: '!warn',
        });
      }

      console.log(
        `[MODERATION] Auto-escalated report ${report.id} - ${pendingOrReviewCount} reports for subject ${report.subject}`
      );
    }
  }
}

export const moderationService = new ModerationService();
