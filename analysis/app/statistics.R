# SPDX-License-Identifier: MIT
# The same script runs in WebR and native R; input/output are explicit JSON files.
experianalysis <- function(input) {
  d <- input$dataset; o <- input$options
  option <- function(name,default)if(is.null(o[[name]]))default else o[[name]]
  minimumObserved<-as.integer(option('minimumObserved',2));adjustMethod<-option('pAdjust','BH');statMethod<-option('statisticalMethod','limma')
  normalization<-option('normalization',if(isTRUE(o$medianNormalize))'median' else 'none')
  imputation<-option('imputation','none');imputationScope<-option('imputationScope','visualization');seed<-as.integer(option('seed',417))
  if(!minimumObserved %in% 1:100 || !adjustMethod %in% c('BH','BY') || !statMethod %in% c('limma','welch'))stop('Invalid statistics node settings.')
  if(!normalization %in% c('none','median','quantile') || !imputation %in% c('none','MinProb','knn') || !imputationScope %in% c('visualization','model','both'))stop('Invalid processing node settings.')
  if(d$mode!='proteomics' && (normalization!='none'||imputation!='none'||statMethod!='limma'))stop('LFQ-specific processing cannot be applied to RNA modes.')
  ids <- unlist(d$featureIds); samples <- unlist(d$sampleIds); groups <- unlist(d$groups)
  raw <- do.call(rbind,lapply(d$values,function(row)vapply(row,function(v)if(is.null(v))NA_real_ else as.numeric(v),numeric(1))))
  dimnames(raw) <- list(ids,samples)
  warnings <- character()
  capture <- function(expr)withCallingHandlers(expr,warning=function(w){warnings<<-c(warnings,conditionMessage(w));invokeRestart('muffleWarning')})
  if (length(samples)<1 || any(!is.finite(raw[!is.na(raw)])))stop('Invalid matrix.')
  counts <- colSums(!is.na(raw) & if(d$mode=='counts')raw>0 else if(d$scale=='linear')raw>0 else TRUE)
  modelMatrix <- NULL;modelSamples <- character();normFactors <- NULL;modelFactors <- NULL;modelLibraries <- NULL
  if (d$mode=='counts') {
    if(anyNA(raw)||any(raw<0)||any(raw!=floor(raw)))stop('Counts must be nonnegative integers without missing values.')
    if(any(colSums(raw)==0))stop('存在文库总计数为零的样本，请检查后重新导入或明确排除。')
    suppressPackageStartupMessages(library(edgeR))
    qy <- edgeR::DGEList(raw);qy <- capture(edgeR::calcNormFactors(qy,method='TMM'))
    mat <- edgeR::cpm(qy,log=TRUE,prior.count=2)
    normFactors <- qy$samples$norm.factors
  } else {
    mat <- raw
    if(d$scale=='linear') {
      if(d$mode=='expression')mat<-log2(raw+1)
      else {mat[mat<=0]<-NA_real_;mat<-log2(mat)}
    }
    if(normalization=='median' && d$mode=='proteomics'){
      med<-apply(mat,2,median,na.rm=TRUE)
      if(any(!is.finite(med)))stop('不能对全缺失样本作中位数归一化。')
      mat<-sweep(mat,2,med-median(med),'-')
      normFactors<-med-median(med)
    }
    if(normalization=='quantile' && d$mode=='proteomics'){
      if(any(colSums(is.finite(mat))==0))stop('全缺失样本不能进行分位数归一化。')
      mat<-limma::normalizeBetweenArrays(mat,method='quantile')
    }
  }
  observedMatrix<-mat;imputedMask<-matrix(FALSE,nrow(mat),ncol(mat));imputedMatrix<-mat
  if(imputation!='none'){
    set.seed(seed)
    usable<-rowSums(is.finite(mat))>0
    if(imputation=='MinProb'){
      if(!requireNamespace('imputeLCMD',quietly=TRUE))stop('MinProb需要本机imputeLCMD包；请运行本机环境检查，未更换方法。')
      imputedMatrix[usable,]<-capture(imputeLCMD::impute.MinProb(mat[usable,,drop=FALSE],q=.01,tune.sigma=1))
    }else{
      if(!requireNamespace('impute',quietly=TRUE))stop('KNN需要本机impute包；未更换方法。')
      eligibleKNN<-rowSums(is.finite(mat))>=2
      if(sum(eligibleKNN)<2)stop('KNN至少需要两个有足够观测的特征。')
      imputedMatrix[eligibleKNN,]<-capture(impute::impute.knn(mat[eligibleKNN,,drop=FALSE],k=min(10,sum(eligibleKNN)-1),rowmax=1,colmax=1,rng.seed=seed)$data)
    }
    imputedMask<-!is.finite(observedMatrix)&is.finite(imputedMatrix)
    if(imputationScope %in% c('visualization','both'))mat<-imputedMatrix
  }
  fittingMatrix<-if(imputation!='none'&&imputationScope %in% c('model','both'))imputedMatrix else observedMatrix
  complete<-apply(mat,1,function(x)all(is.finite(x)) && sd(x)>0)
  pca<-list(scores=matrix(numeric(0),nrow=length(samples),ncol=0),variance=I(numeric()),features=sum(complete),status='完整观测且有变异的特征不足，未计算 PCA。')
  if(sum(complete)>=2 && length(samples)>=2){
    pc<-capture(prcomp(t(mat[complete,,drop=FALSE]),center=TRUE,scale.=FALSE))
    ncomp<-min(5,ncol(pc$x));var<-pc$sdev^2
    pca<-list(scores=unname(pc$x[,seq_len(ncomp),drop=FALSE]),variance=I(var/sum(var)),features=sum(complete),status='完整观测特征；按特征中心化；不插补。')
  }
  if(imputation!='none'&&imputationScope %in% c('visualization','both'))pca$status<-paste('显示矩阵使用',imputation,'；保留原始观测标记；按特征中心化。')
  corr<-suppressWarnings(cor(mat,use='pairwise.complete.obs',method='pearson'))
  nPair<-outer(seq_along(samples),seq_along(samples),Vectorize(function(i,j)sum(is.finite(mat[,i])&is.finite(mat[,j]))))
  finiteMedian<-function(x){x<-x[is.finite(x)];if(length(x))median(x)else NA_real_}
  distribution<-lapply(seq_along(samples),function(j){v<-sort(mat[is.finite(mat[,j]),j]);if(length(v)>600)v<-v[unique(round(seq(1,length(v),length.out=600)))];I(v)})
  differential<-data.frame(id=ids,logFC=NA_real_,PValue=NA_real_,FDR=NA_real_,status='exploration_only',nCase=NA_integer_,nControl=NA_integer_,stringsAsFactors=FALSE)
  method<-if(d$mode=='counts')'原始 counts；QC 使用 TMM 后 log2 CPM（prior.count=2）；PCA 仅完整观测特征。' else if(d$mode=='expression')paste0('仅表达探索；',if(d$scale=='linear')'log2(x+1)'else'输入已为 log2，未再次变换','；不计算差异 P 值或 FDR。')else paste0('LFQ；',if(d$scale=='linear')'非正强度在下游矩阵中标为缺失；log2(x)'else'输入已为 log2，未再次变换','；',if(isTRUE(o$medianNormalize))'按样本中位数追加归一化。'else'未追加归一化。','不插补。')
  if(d$mode!='expression'){
    if(is.null(o$caseGroup)||is.null(o$controlGroup)||o$caseGroup==o$controlGroup)stop('请选择两个不同组别。')
    selected<-which(groups %in% c(o$controlGroup,o$caseGroup)); g<-factor(groups[selected],levels=c(o$controlGroup,o$caseGroup))
    if(any(table(g)<2))stop('每组至少需要两个独立生物样本。')
    if(any(table(g)<3))warnings<-c(warnings,'每组不足三个生物重复，方差及效应估计可能不稳定。')
    design<-model.matrix(~0+g);colnames(design)<-c('control','case');contrast<-c(-1,1)
    modelSamples<-samples[selected]
    if(d$mode=='counts'){
      y<-edgeR::DGEList(raw[,selected,drop=FALSE]); keep<-edgeR::filterByExpr(y,design=design)
      differential$status<-'filtered_low_expression'
      if(sum(keep)<2)stop('低表达过滤后不足两个基因，无法估计离散度。')
      y<-y[keep,,keep.lib.sizes=FALSE];y<-capture(edgeR::calcNormFactors(y,method='TMM'))
      y<-capture(edgeR::estimateDisp(y,design));fit<-capture(edgeR::glmQLFit(y,design,robust=FALSE))
      tt<-capture(edgeR::glmQLFTest(fit,contrast=contrast))$table
      ii<-which(keep);differential$logFC[ii]<-tt$logFC;differential$PValue[ii]<-tt$PValue;differential$status[ii]<-'tested'
      differential$nCase<-sum(g==o$caseGroup);differential$nControl<-sum(g==o$controlGroup)
      modelMatrix<-edgeR::cpm(y,log=TRUE,prior.count=2)
      modelFactors<-y$samples$norm.factors;modelLibraries<-y$samples$lib.size
      method<-paste0(method,' 差异分析只拟合所选两组：filterByExpr → 重新计算 TMM → estimateDisp → glmQLFit(robust=FALSE) → glmQLFTest；方向 ',o$caseGroup,' − ',o$controlGroup,'；全体可检验基因统一 BH 校正。QC 与模型使用各自明确的样本/基因集合。')
    } else {
      suppressPackageStartupMessages(library(limma))
      modelMatrix<-fittingMatrix[,selected,drop=FALSE]
      nc<-rowSums(is.finite(observedMatrix[,selected[g==o$caseGroup],drop=FALSE])); nr<-rowSums(is.finite(observedMatrix[,selected[g==o$controlGroup],drop=FALSE]))
      differential$nCase<-nc;differential$nControl<-nr
      differential$status<-'insufficient_observations';differential$status[nc>0&nr==0]<-'case_only';differential$status[nr>0&nc==0]<-'control_only'
      eligible<-nc>=minimumObserved&nr>=minimumObserved
      if(sum(eligible)<2)stop('符合每组观测数条件的蛋白不足两个。')
      ii<-which(eligible)
      differential$t<-NA_real_;differential$CI_low<-NA_real_;differential$CI_high<-NA_real_;differential$df<-NA_real_
      if(statMethod=='limma'){
        fit<-capture(limma::lmFit(modelMatrix[eligible,,drop=FALSE],design));fit<-limma::contrasts.fit(fit,contrast)
        if(!any(fit$sigma>0,na.rm=TRUE))stop('全部蛋白的组内残差方差为零，无法可靠估计统计模型。')
        fit<-capture(limma::eBayes(fit,trend=FALSE,robust=FALSE))
        differential$logFC[ii]<-fit$coefficients[,1];differential$PValue[ii]<-fit$p.value[,1];differential$status[ii]<-'tested'
        differential$t[ii]<-fit$t[,1];se<-fit$stdev.unscaled[,1]*sqrt(fit$s2.post);crit<-qt(.975,df=fit$df.total)
        differential$CI_low[ii]<-fit$coefficients[,1]-crit*se;differential$CI_high[ii]<-fit$coefficients[,1]+crit*se;differential$df[ii]<-fit$df.total
      }else{
        for(i in ii){
          x<-modelMatrix[i,g==o$caseGroup];y<-modelMatrix[i,g==o$controlGroup];x<-x[is.finite(x)];y<-y[is.finite(y)]
          differential$logFC[i]<-mean(x)-mean(y)
          test<-tryCatch(t.test(x,y,var.equal=FALSE),error=function(e)NULL)
          if(!is.null(test)){differential$PValue[i]<-test$p.value;differential$t[i]<-unname(test$statistic);differential$df[i]<-unname(test$parameter);differential$CI_low[i]<-test$conf.int[1];differential$CI_high[i]<-test$conf.int[2];differential$status[i]<-'tested'}
          else differential$status[i]<-'undefined_test'
        }
      }
      method<-paste0(method,' 差异分析只拟合所选两组；每组至少 ',minimumObserved,' 个原始有效生物观测；',if(statMethod=='limma')'limma lmFit → contrasts.fit → eBayes(trend=FALSE,robust=FALSE)'else'Welch独立样本t检验','；方向 ',o$caseGroup,' − ',o$controlGroup,'；全体有限P值统一 ',adjustMethod,' 校正。单组全缺失仅登记检出状态，插补不改变观测数资格。')
    }
    valid<-is.finite(differential$PValue)&is.finite(differential$logFC)
    differential$status[differential$status=='tested'&!valid]<-'undefined_test'
    differential$PValue[!valid]<-NA_real_;differential$FDR[valid]<-p.adjust(differential$PValue[valid],method=adjustMethod)
  }
  alpha<-if(is.null(o$alpha))0.05 else as.numeric(o$alpha);lfc<-if(is.null(o$lfcThreshold))0 else as.numeric(o$lfcThreshold)
  differential$hit<-differential$status=='tested' & !is.na(differential$FDR) & differential$FDR<alpha & abs(differential$logFC)>=lfc
  if(imputation!='none')method<-gsub('不插补。','',method,fixed=TRUE)
  if(normalization=='quantile')method<-gsub('未追加归一化。','已追加分位数归一化。',method,fixed=TRUE)
  method<-paste0(method,' 节点设置：归一化=',normalization,'；插补=',imputation,'；范围=',imputationScope,'；seed=',seed,'。')
  list(mode=d$mode,sampleIds=I(samples),featureIds=I(ids),groups=I(groups),rawMatrix=unname(raw),matrix=unname(mat),observedMatrix=unname(observedMatrix),imputedMask=unname(imputedMask),
       modelMatrix=if(is.null(modelMatrix))NULL else unname(modelMatrix),modelFeatureIds=if(is.null(modelMatrix))NULL else I(rownames(modelMatrix)),modelSampleIds=I(modelSamples),
       qc=list(counts=I(counts),missing=I(colSums(!is.finite(if(d$mode=='counts')raw else observedMatrix))/nrow(raw)),medians=I(apply(mat,2,finiteMedian)),correlation=unname(corr),correlationPairs=unname(nPair),pca=pca,distributions=distribution,librarySizes=if(d$mode=='counts')I(colSums(raw))else NULL,normalizationFactors=if(is.null(normFactors))NULL else I(normFactors)),
       differential=differential,method=method,warnings=I(unique(warnings)),audit=list(technicalAggregation=d$audit$technicalAggregation,extraNormalization=normalization!='none'&&d$mode=='proteomics',normalization=normalization,imputation=imputation,imputationScope=imputationScope,imputedCells=sum(imputedMask),seed=seed,minimumObserved=minimumObserved,statisticalMethod=statMethod,pcaFeatureCount=sum(complete),testingSamples=I(modelSamples),modelNormalizationFactors=if(is.null(modelFactors))NULL else I(modelFactors),modelLibrarySizes=if(is.null(modelLibraries))NULL else I(modelLibraries),testedFeatures=sum(differential$status=='tested'),testFamily=paste(adjustMethod,'across finite tests in selected contrast'),effectDirection=paste(o$caseGroup,'-',o$controlGroup)),
       versions=list(R=as.character(getRversion()),limma=if(requireNamespace('limma',quietly=TRUE))as.character(packageVersion('limma'))else NULL,edgeR=if(requireNamespace('edgeR',quietly=TRUE))as.character(packageVersion('edgeR'))else NULL,impute=if(imputation=='knn')as.character(packageVersion('impute'))else NULL,imputeLCMD=if(imputation=='MinProb')as.character(packageVersion('imputeLCMD'))else NULL,jsonlite=as.character(packageVersion('jsonlite'))))
}
run_experianalysis_file <- function(input='/input.json',output='/result.json'){
  input<-jsonlite::fromJSON(input,simplifyVector=FALSE)
  result<-experianalysis(input)
  jsonlite::write_json(result,output,auto_unbox=TRUE,digits=16,na='null',dataframe='rows',matrix='rowmajor',null='null',pretty=FALSE)
  invisible(result)
}
