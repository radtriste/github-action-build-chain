import { CheckedOutNode } from "@bc/domain/checkout";
import { ExecutionResult } from "@bc/domain/execute-command-result";
import { ExecuteNodeResult } from "@bc/domain/execute-node-result";
import { ExecutionPhase } from "@bc/domain/execution-phase";
import { FlowResult } from "@bc/domain/flow";
import { NodeExecution } from "@bc/domain/node-execution";
import { ArtifactService } from "@bc/service/artifacts/artifact-service";
import { CheckoutService } from "@bc/service/checkout/checkout-service";
import { ExecuteCommandService } from "@bc/service/command/execute-command-service";
import { ConfigurationService } from "@bc/service/config/configuration-service";
import { BaseLoggerService } from "@bc/service/logger/base-logger-service";
import { LoggerService } from "@bc/service/logger/logger-service";
import Container, { Service } from "typedi";

@Service()
export class FlowService {
  private configService: ConfigurationService;
  private checkoutService: CheckoutService;
  private executor: ExecuteCommandService;
  private logger: BaseLoggerService;
  private artifactService: ArtifactService;

  constructor() {
    this.configService = Container.get(ConfigurationService);
    this.checkoutService = Container.get(CheckoutService);
    this.executor = Container.get(ExecuteCommandService);
    this.artifactService = Container.get(ArtifactService);
    this.logger = Container.get(LoggerService).logger;
  }

  async run(): Promise<FlowResult> {
    this.logger.startGroup("Execution Plan");
    this.printExecutionPlan();
    this.logger.endGroup();

    this.logger.startGroup(
      `Checking out ${this.configService.getStarterProjectName()} and its dependencies (${this.configService.nodeChain.length} projects in total). It can take some time.`
    );
    const checkoutInfo = await this.checkoutService.checkoutDefinitionTree();
    this.logger.endGroup();
    this.logger.startGroup("Checkout summary");
    this.printCheckoutSummary(checkoutInfo);
    this.logger.endGroup();

    /**
     * Cannot directly map checkoutInfo into NodeExecution array since the order of nodes might change when parallely checking
     * out the node chain
     */
    const nodeChainForExecution: NodeExecution[] = this.configService.nodeChain.map(node => ({
      node,
      // nodeCheckoutInfo will never be undefined since checkoutInfo is constructed from node chain and so node project will exist
      cwd: checkoutInfo.find(info => info.node.project === node.project)!.checkoutInfo?.repoDir,
    }));

    const executionResult = await this.executeAndPrint(nodeChainForExecution);

    // archive artifacts
    this.logger.startGroup("Uploading artifacts");
    const artifactUploadResults = await this.artifactService.uploadNodes(this.configService.nodeChain, this.configService.getStarterNode());
    this.logger.endGroup();

    return { checkoutInfo, artifactUploadResults, executionResult };
  }

  /**
   * Prints the execution plan for the node chain in the following format:
   *
   * 3 projects will be executed
   * [owner/project]
   *    Level type: current
   *    [before]
   *        cmd1
   *        cmd2
   *    [command]
   *        cmd1
   *    [after]
   *        cmd1
   * [abc/xyz]
   *    Level type: downstream
   *    No command will be executed (this project will be skipped)
   * [def/ghi]
   *    Level type: upstream
   *    [before]
   *        cmd1
   *    [after]
   *        cmd1
   */
  private printExecutionPlan() {
    this.logger.info(`${this.configService.nodeChain.length} projects will be executed`);
    this.configService.nodeChain.forEach(node => {
      const nodeLevel = this.configService.getNodeExecutionLevel(node);
      this.logger.info(`[${node.project}]`);
      this.logger.info(`\t Level type: ${nodeLevel}`);

      if (this.configService.skipExecution(node)) {
        this.logger.info("\t No command will be executed (this project will be skipped)");
      } else {
        const before = this.executor.getNodeCommands(node, ExecutionPhase.BEFORE, nodeLevel);
        const current = this.executor.getNodeCommands(node, ExecutionPhase.CURRENT, nodeLevel);
        const after = this.executor.getNodeCommands(node, ExecutionPhase.AFTER, nodeLevel);

        if (before?.length) {
          this.logger.info(`\t [${ExecutionPhase.BEFORE}]`);
          this.logger.info(`\t\t ${before.join("\n")}`);
        }

        if (current?.length) {
          this.logger.info(`\t [${ExecutionPhase.CURRENT}]`);
          this.logger.info(`\t\t ${current.join("\n")}`);
        }

        if (after?.length) {
          this.logger.info(`\t [${ExecutionPhase.AFTER}]`);
          this.logger.info(`\t\t ${after.join("\n")}`);
        }
      }
    });
  }

  /**
   * Prints the checkout info for the node chain in the following format:
   *
   * [owner/project]
   *    Project taken from owner/project:main
   *    Merged owner1/project-forked:
   * [abc/xyz]
   *    This project wasn't checked out
   * [def/ghi]
   *    Project taken from def/ghi:dev
   */
  private printCheckoutSummary(checkoutInfo: CheckedOutNode[]) {
    checkoutInfo.forEach(info => {
      this.logger.info(`[${info.node.project}]`);
      if (info.checkoutInfo) {
        this.logger.info(`\t Project taken from ${info.checkoutInfo.targetGroup}/${info.checkoutInfo.targetName}:${info.checkoutInfo.targetBranch}`);
        if (info.checkoutInfo.merge) {
          this.logger.info(
            `\t Merged ${info.checkoutInfo.sourceGroup}/${info.checkoutInfo.sourceName}:${info.checkoutInfo.sourceBranch} into branch ${info.checkoutInfo.targetBranch}`
          );
        }
      } else {
        this.logger.info("\t This project wasn't checked out");
      }
    });
  }

  /**
   * Prints the checkout info for the node chain in the following format:
   *
   * [owner/project]
   *    [OK] cmd1 [Executed in: 10s]
   * [abc/xyz]
   *    No commands were found for this project
   * [def/ghi]
   *    [NOT_OK] cmd2 [Executed in: 5s]
   *        Error: msg
   */
  private printExecutionSummary(result: ExecuteNodeResult[]) {
    this.printExecutionSummaryForPhase(result[0], ExecutionPhase.BEFORE);
    this.printExecutionSummaryForPhase(result[1], ExecutionPhase.CURRENT);
    this.printExecutionSummaryForPhase(result[2], ExecutionPhase.AFTER);
  }

  private printExecutionSummaryForPhase(result: ExecuteNodeResult, phase: ExecutionPhase) {
    if (this.isNodeExecutionSkipped(result)) {
      this.logger.info(`[${phase.toUpperCase()}] Skipped ${result.node.project}`);
    } else {
      if (!result.executeCommandResults.length) {
        this.logger.info(`[${phase.toUpperCase()}] No commands were found for ${result.node.project}`);
      }
      result.executeCommandResults.forEach(cmdRes => {
        this.logger.startGroup(`[${phase.toUpperCase()}] [${result.node.project}] ${cmdRes.command}`);
        this.logger.info(`${cmdRes.result} [Executed in ${cmdRes.time} ms]`);
        if (cmdRes.result === ExecutionResult.NOT_OK) {
          this.logger.error(cmdRes.errorMessage);
        }
        this.logger.endGroup();
      });
    }
  }

  private async executeAndPrint(chain: NodeExecution[]): Promise<ExecuteNodeResult[][]> {
    const result: ExecuteNodeResult[][] = [];
    for (const node of chain) {
      this.logger.startGroup(`Executing ${node.node.project}`);
      const currentNodeResult = await this.executor.executeNodeCommands(node);
      result.push(currentNodeResult);
      this.logger.info(`Execution summary for ${node.node.project}`);
      this.printExecutionSummary(currentNodeResult);
      this.logger.endGroup();
    }
    return result;
  }

  private isNodeExecutionSkipped(result: ExecuteNodeResult) {
    return !!result.executeCommandResults.find(res => res.result === ExecutionResult.SKIP);
  }
}
