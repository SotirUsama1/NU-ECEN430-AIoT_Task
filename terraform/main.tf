module "vpc" {
  source  = "./modules/VPC"
  context = local.context

  public_subnet_count   = var.vpc_public_subnet_count
  private_subnet_count  = var.vpc_private_subnet_count
  isolated_subnet_count = var.vpc_isolated_subnet_count

  enable_dns_support   = var.vpc_enable_dns_support
  enable_dns_hostnames = var.vpc_enable_dns_hostnames

  tags = var.vpc_tags
}

data "aws_iam_policy_document" "cloudwatch_agent_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cloudwatch_agent" {
  name               = "${local.context.namespace}-cloudwatch-agent"
  assume_role_policy = data.aws_iam_policy_document.cloudwatch_agent_assume_role.json
  tags               = var.vpc_tags
}

resource "aws_iam_role_policy_attachment" "cloudwatch_agent_server" {
  role       = aws_iam_role.cloudwatch_agent.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_instance_profile" "cloudwatch_agent" {
  name = "${local.context.namespace}-cloudwatch-agent"
  role = aws_iam_role.cloudwatch_agent.name
  tags = var.vpc_tags
}

resource "aws_ec2_serial_console_access" "regional" {
  enabled = true
}

resource "aws_security_group" "example" {
  name        = "example-security-group"
  description = "Example security group"
  vpc_id      = module.vpc.vpc_ids[0]

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "example" {
  ami                         = "ami-07bb6b84c682e27b8"
  instance_type               = "t3.micro"
  key_name                    = "DEPI-test-key-paris"
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.cloudwatch_agent.name
  user_data                   = templatefile("${path.module}/cloudwatch-agent-user-data.sh.tftpl", { region = var.aws_region })
  user_data_replace_on_change = false

  vpc_security_group_ids = [aws_security_group.example.id]
  subnet_id              = module.vpc.public_subnet_ids[0]

  tags = {
    Name = "DEPI-lab-instance"
  }
}

data "aws_iam_policy_document" "dashboard" {
  statement {
    sid = "ReadDashboardInstanceAndSerialStatus"
    actions = [
      "ec2:DescribeInstances",
      "ec2:DescribeInstanceStatus",
      "ec2:GetSerialConsoleAccessStatus",
    ]
    resources = ["*"]
  }

  statement {
    sid = "OperateDashboardInstance"
    actions = [
      "ec2:RebootInstances",
      "ec2-instance-connect:SendSerialConsoleSSHPublicKey",
    ]
    resources = [aws_instance.example.arn]
  }
}

resource "aws_iam_policy" "dashboard" {
  name        = "${local.context.namespace}-serial-dashboard"
  description = "Permissions for the EC2 serial console dashboard on its managed instance."
  policy      = data.aws_iam_policy_document.dashboard.json
  tags        = var.vpc_tags
}

resource "aws_iam_role_policy_attachment" "dashboard" {
  count      = var.dashboard_iam_identity.type == "role" ? 1 : 0
  role       = var.dashboard_iam_identity.name
  policy_arn = aws_iam_policy.dashboard.arn
}

resource "aws_iam_user_policy_attachment" "dashboard" {
  count      = var.dashboard_iam_identity.type == "user" ? 1 : 0
  user       = var.dashboard_iam_identity.name
  policy_arn = aws_iam_policy.dashboard.arn
}


# ### EC2 Instance Example
# #{

# module "ec2_instance" {
#   source = "./modules/EC2"
# #   context = local.context
# #   count = var.ec2_instance_count

# #   # Naming convention used is: <instance_name> || <owner>-<org>-<project>-<env>-<suffix>
# #   instance_name = var.ec2_instance_name
# #   instance_name_suffix = var.ec2_instance_name_suffix

# #   ami_id = var.ec2_ami_id
# #   instance_type = var.ec2_instance_type
# #   key_name = var.ec2_key_name
# #   security_group_ids = var.ec2_security_group_ids
# #   subnet_id = var.ec2_subnet_id

# #   instance_tags = var.ec2_instance_tags
# }

# #}


# ### S3 Bucket Example
# #{

# module "s3_bucket" {
#   source = "./modules/S3"
#   context = local.context

#   # Naming convention used is: <bucket_name> || <owner>-<org>-<project>-<env>-<suffix>
#   bucket_name = var.s3_bucket_name
#   bucket_name_suffix = var.s3_bucket_name_suffix

#   force_destroy = var.s3_force_destroy
#   versioning = var.s3_versioning
#   versioning_configuration = var.s3_versioning_configuration

#   bucket_tags = var.s3_bucket_tags
# }

# # }
