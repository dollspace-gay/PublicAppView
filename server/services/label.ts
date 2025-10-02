import { storage } from "../storage";
import type { InsertLabel, Label, InsertLabelDefinition, LabelDefinition } from "@shared/schema";

export class LabelService {
  async applyLabel(params: {
    src: string;
    subject: string;
    val: string;
    neg?: boolean;
    createdAt?: Date;
  }): Promise<Label> {
    const uri = `at://${params.src}/app.bsky.labeler.label/${Date.now()}`;
    
    const label: InsertLabel = {
      uri,
      src: params.src,
      subject: params.subject,
      val: params.val,
      neg: params.neg || false,
      createdAt: params.createdAt || new Date(),
    };

    const createdLabel = await storage.createLabel(label);
    
    await storage.createLabelEvent({
      labelUri: uri,
      action: "created",
    });

    return createdLabel;
  }

  async negateLabel(params: {
    src: string;
    subject: string;
    val: string;
  }): Promise<Label> {
    return this.applyLabel({
      ...params,
      neg: true,
    });
  }

  async removeLabel(uri: string): Promise<void> {
    await storage.createLabelEvent({
      labelUri: uri,
      action: "deleted",
    });

    await storage.deleteLabel(uri);
  }

  async getLabelsForSubject(subject: string): Promise<Label[]> {
    return await storage.getLabelsForSubject(subject);
  }

  async getLabelsForSubjects(subjects: string[]): Promise<Map<string, Label[]>> {
    const allLabels = await storage.getLabelsForSubjects(subjects);
    const labelMap = new Map<string, Label[]>();

    for (const label of allLabels) {
      const existing = labelMap.get(label.subject) || [];
      existing.push(label);
      labelMap.set(label.subject, existing);
    }

    return labelMap;
  }

  async queryLabels(params: {
    sources?: string[];
    subjects?: string[];
    values?: string[];
    limit?: number;
  }): Promise<Label[]> {
    return await storage.queryLabels(params);
  }

  async getActiveLabelsForSubject(subject: string): Promise<Label[]> {
    const labels = await storage.getLabelsForSubject(subject);
    return this.filterNegatedLabels(labels);
  }

  async getActiveLabelsForSubjects(subjects: string[]): Promise<Map<string, Label[]>> {
    const allLabels = await storage.getLabelsForSubjects(subjects);
    const labelMap = new Map<string, Label[]>();

    for (const label of allLabels) {
      const existing = labelMap.get(label.subject) || [];
      existing.push(label);
      labelMap.set(label.subject, existing);
    }

    const result = new Map<string, Label[]>();
    for (const [subject, labels] of Array.from(labelMap.entries())) {
      result.set(subject, this.filterNegatedLabels(labels));
    }

    return result;
  }

  async createLabelDefinition(params: {
    value: string;
    description?: string;
    severity?: "info" | "warn" | "alert" | "none";
    localizedStrings?: Record<string, any>;
  }): Promise<LabelDefinition> {
    const definition: InsertLabelDefinition = {
      value: params.value,
      description: params.description,
      severity: params.severity || "warn",
      localizedStrings: params.localizedStrings || {},
    };

    return await storage.createLabelDefinition(definition);
  }

  async getLabelDefinition(value: string): Promise<LabelDefinition | undefined> {
    return await storage.getLabelDefinition(value);
  }

  async getAllLabelDefinitions(): Promise<LabelDefinition[]> {
    return await storage.getAllLabelDefinitions();
  }

  async updateLabelDefinition(
    value: string,
    data: Partial<InsertLabelDefinition>
  ): Promise<LabelDefinition | undefined> {
    return await storage.updateLabelDefinition(value, data);
  }

  async getRecentLabelEvents(limit = 100, since?: Date) {
    return await storage.getRecentLabelEvents(limit, since);
  }

  private filterNegatedLabels(labels: Label[]): Label[] {
    const labelMap = new Map<string, Label>();

    for (const label of labels.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const key = `${label.subject}:${label.val}`;

      if (label.neg) {
        labelMap.delete(key);
      } else {
        labelMap.set(key, label);
      }
    }

    return Array.from(labelMap.values());
  }
}

export const labelService = new LabelService();
